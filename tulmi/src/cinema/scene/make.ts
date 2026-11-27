/**
 * THE LOOP. One ask in, a rendered thing out, with the model looking at its own work in between.
 *
 *   make(ctx, o)   ask → scene → script → preview → look → fix → preview → … → the real render
 *
 * Nobody makes a 3D picture in one go, and a model is no different. The difference between this and a prompt is the LOOKING:
 * each round renders something small and cheap, shows it to the eye (eye.ts), and the next round is told what was wrong with
 * the last. Two or three rounds is usually the whole of it. The expensive render happens once, at the end, when the cheap one
 * is right.
 *
 * It stops for one of five reasons and always says which: the eye was happy (`done`), the rounds ran out (`rounds`), the
 * money ran out (`budget`), the renderer could not run it (`render`), or the model never answered (`model`). Whatever the
 * reason, everything made up to then is kept, because a scene that is nearly right is worth more than an error.
 *
 * WHAT IT IS NOT. It knows nothing about bots, jobs, chats or screens: it is handed a way to run Blender and a way to keep
 * bytes, and it hands back what it made. Fitting it to the cinema bot — its stages, its progress, its decision cards — is
 * done above this file, and nothing here needs to change for it.
 */
import { z } from "zod";
import type { BlobStore } from "../../media/blob.js";
import { askJson, cut, fence, type ModelCtx } from "../../code/work/model.js";
import { checkScene, frameCount, sceneSize } from "./check.js";
import { lookAt, type Verdict } from "./eye.js";
import { briefOf } from "./brief.js";
import { creationKey, keep, type Kept, type Render, type Shot } from "./ports.js";
import { scriptFor } from "./script.js";
import { CAPS, type Scene } from "./types.js";

/** Loose on purpose: check.ts reads every field, and one bad object must not lose the scene. */
export const SceneReply = z.object({
  look: z.unknown().optional(),
  camera: z.unknown().optional(),
  lights: z.unknown().optional(),
  objects: z.unknown().optional(),
  materials: z.unknown().optional(),
  move: z.unknown().optional(),
  seed: z.unknown().optional(),
});

export interface MakeOpts {
  /** What the person asked for, in their words. */
  ask: string;
  /** Which creation this is, and which version of it: the keys everything is kept under. */
  creation: string;
  version?: number;
  /** The assets this person may use: name → where it is for the machine that renders. Only the NAMES reach the model. */
  assets?: Record<string, string>;
  /** How many build-and-look rounds at most (the first one included). */
  rounds?: number;
  /** The most the models may spend over the whole thing, in paise. */
  capPaise?: number;
  /** Give up on one preview, and on the real render, after this long. */
  previewMs?: number;
  finalMs?: number;
  /** Keep the .blend as well (it is the big one). */
  keepBlend?: boolean;
  /** Start from this scene instead of a blank page (a change to something already made). */
  from?: Scene;
  /**
   * A PICTURE OF THE IDEA to build from (docs/cinema-3d.md §2a): read once into a brief the builder builds from (brief.ts), and
   * shown to the eye beside every render, so each round is judged against what they wanted to see.
   */
  reference?: { bytes: Buffer; mime: string };
  /** Told after each round, so a person can watch the preview get better while it builds. Never awaited by the loop's logic. */
  onRound?: (r: Round) => void | Promise<void>;
  /** How many more angles of a still to render at the end, round the thing (default 2): what makes it read as 3D. */
  views?: number;
}

export interface Round {
  /** 1, 2, 3… */
  n: number;
  /** What the checker had to change. */
  notes: string[];
  /** How many objects the scene came to, parts counted. */
  objects: number;
  /** What the renderer said, when it could not run it. */
  renderError?: string;
  /** What the eye made of the preview. */
  verdict?: Verdict;
  /** What this round's models cost. */
  paise: number;
  ms: number;
  /** The preview, kept. */
  preview?: Kept;
}

export interface Made {
  ok: boolean;
  /** Why it stopped. */
  why: "done" | "rounds" | "budget" | "render" | "model";
  scene: Scene | null;
  /** The script that makes it again, exactly. */
  script: string;
  rounds: Round[];
  kept: { script?: Kept; preview?: Kept; final?: Kept; blend?: Kept; views?: Kept[] };
  /** The brief the picture was read into, when there was a picture. */
  brief?: string;
  /** The real render, when one was made: a picture, or a clip. */
  mime?: string;
  paise: number;
  ms: number;
}

const ASK_CHARS = 1_400;
const NOTE_CHARS = 90;
/** What one scene call may write. A scene of eighty objects is a long answer. */
const SCENE_TOKENS = 7_000;

/**
 * What the model reads. The ask is fenced as data; the rest is the state of the work — what it built last time, what the
 * checker had to change, and what the eye saw. Nothing here is a prompt: who the model is lives in principles/roles.ts.
 */
export function sceneUser(o: {
  ask: string;
  assets: string[];
  round: number;
  brief?: string | null;
  scene?: Scene | null;
  notes?: string[];
  verdict?: Verdict | null;
  renderError?: string;
}): string {
  const out: string[] = ["<request>", fence(cut(o.ask, ASK_CHARS)), "</request>"];
  if (o.brief) out.push("", "They showed a picture of the idea. What is in it, to build:", "<picture>", fence(cut(o.brief, 2_400)), "</picture>", "Build THAT: the same things, shapes, proportions, colours and camera angle, out of parts.");
  if (o.assets.length) out.push("", `Assets you may name: ${o.assets.slice(0, 40).join(", ")}`);
  out.push("", `At most: ${CAPS.objects} objects, ${CAPS.lights} lights, ${CAPS.materials} materials, ${CAPS.seconds}s of film, ${CAPS.size}px.`);
  if (o.round > 1 && o.scene) {
    out.push("", "This is what you built last time:", "<data>", fence(JSON.stringify(o.scene)), "</data>");
    if (o.notes?.length) out.push("", `What had to be changed to render it: ${o.notes.slice(0, 8).map((s) => cut(s, NOTE_CHARS)).join("; ")}`);
    if (o.renderError) out.push("", `It did not render: ${cut(o.renderError, 240)}`);
    if (o.verdict && !o.verdict.ok) {
      if (o.verdict.issues.length) out.push("", `Looking at the render: ${o.verdict.issues.join("; ")}`);
      if (o.verdict.fix) out.push(`The one change to make: ${o.verdict.fix}`);
    }
    out.push("", "Answer with the whole scene again, with that put right and the rest as it was.");
  }
  return out.join("\n");
}

/**
 * The same scene seen from another side: the camera walked round what it looks at by `deg` about the vertical, and raised by
 * `lift` (a share of its distance) to look down on it. Nothing in the scene changes, so the pictures are one object from
 * several places — which is what makes a still read as a thing and not a picture.
 */
export function turned(scene: Scene, deg: number, lift = 0): Scene {
  const [ax, ay, az] = scene.camera.at, [tx, ty, tz] = scene.camera.to;
  const r = (deg * Math.PI) / 180, dx = ax - tx, dy = ay - ty;
  const reach = Math.hypot(dx, dy, az - tz);
  const at: [number, number, number] = [tx + dx * Math.cos(r) - dy * Math.sin(r), ty + dx * Math.sin(r) + dy * Math.cos(r), az + lift * reach];
  return { ...scene, camera: { ...scene.camera, at } };
}

/**
 * The other sides it is shown from: round to one side at eye height, round to the other and from above, and from behind.
 * Far enough apart that a round thing still looks different from each, and one from above shows what is on top.
 */
export const VIEWS = [{ turn: -75, lift: 0 }, { turn: 70, lift: 0.6 }, { turn: 180, lift: 0.15 }] as const;

/** A side view: turned, and drawn smaller and with fewer samples than the real one, in the same shape of frame. */
export function sideOf(scene: Scene, v: { turn: number; lift: number }): Scene {
  const t = turned(scene, v.turn, v.lift);
  const k = Math.min(1, 720 / Math.max(scene.look.width, scene.look.height));
  return { ...t, look: { ...t.look, width: Math.round(scene.look.width * k), height: Math.round(scene.look.height * k), samples: Math.min(scene.look.samples, 48) } };
}

/** The frame a move is previewed at: a third of the way in says more than its first frame. */
export const previewFrame = (scene: Scene): number => (scene.move ? Math.max(1, Math.round(frameCount(scene) / 3)) : 1);

/**
 * The whole of it. `render` is wherever Blender runs; `store` is the bucket (null: nothing is kept, and the loop still runs).
 */
export async function make(
  ctx: ModelCtx,
  o: MakeOpts & { render: Render; store: BlobStore | null },
): Promise<Made> {
  const began = Date.now();
  const rounds = Math.max(1, Math.min(5, o.rounds ?? 3));
  const version = Math.max(1, Math.round(o.version ?? 1));
  const assetNames = Object.keys(o.assets ?? {});
  const key = (file: string): string => creationKey(ctx.userId, o.creation, version, file);

  const log: Round[] = [];
  let scene: Scene | null = o.from ?? null;
  let notes: string[] = [];
  let verdict: Verdict | null = null;
  let renderError: string | undefined;
  let paise = 0;
  let preview: Kept | undefined;
  let why: Made["why"] = "rounds";

  // ---- a picture of the idea: read once into what to build
  let brief: string | null = null;
  if (o.reference) {
    const read = await briefOf(ctx, { ask: o.ask, image: o.reference.bytes, mime: o.reference.mime });
    brief = read.brief;
    paise += read.paise;
  }

  for (let n = 1; n <= rounds; n++) {
    const roundBegan = Date.now();
    let roundPaise = 0;

    if (o.capPaise !== undefined && paise >= o.capPaise) { why = "budget"; break; }

    // ---- build it (or put right what the eye saw)
    const asked = await askJson<z.infer<typeof SceneReply>>(ctx, {
      tier: "code",
      purpose: "cinema.scene",
      role: "cinema_scene",
      user: sceneUser({ ask: o.ask, assets: assetNames, round: n, scene, notes, verdict, brief, ...(renderError ? { renderError } : {}) }),
      schema: SceneReply,
      maxTokens: SCENE_TOKENS,
      step: n,
    });
    if (!asked.ok) {
      why = asked.reason === "budget" ? "budget" : "model";
      log.push({ n, notes, objects: scene ? sceneSize(scene) : 0, paise: roundPaise, ms: Date.now() - roundBegan });
      break;
    }
    roundPaise += asked.paise;
    paise += asked.paise;

    const checked = checkScene(asked.value);
    scene = checked.scene;
    notes = checked.notes;
    renderError = undefined;

    // ---- look at it, small and cheap
    const previewScript = scriptFor(scene, { preview: true, frame: previewFrame(scene) });
    const shot = await o.render({
      script: previewScript,
      move: false,
      timeoutMs: o.previewMs ?? 180_000,
      ...(o.assets ? { assets: o.assets } : {}),
    });

    const round: Round = { n, notes, objects: sceneSize(scene), paise: roundPaise, ms: Date.now() - roundBegan };
    if (!shot.ok) {
      renderError = shot.error;
      round.renderError = shot.error;
      log.push(round);
      await Promise.resolve(o.onRound?.(round)).catch(() => undefined);
      // A script that will not run is the next round's problem to fix; out of rounds, it is the end of it.
      if (n === rounds) { why = "render"; }
      continue;
    }

    const png = shot.shots[0]?.bytes;
    if (png && o.store) {
      const k = await keep(o.store, key(`preview-${n}.png`), png, "image/png");
      if (k) { round.preview = k; preview = k; }
    }

    if (png) {
      const seen = await lookAt(ctx, { ask: o.ask, png, round: n, ...(o.reference ? { reference: o.reference } : {}) });
      verdict = seen.verdict;
      roundPaise += seen.paise;
      paise += seen.paise;
      round.paise = roundPaise;
      if (seen.verdict) round.verdict = seen.verdict;
    }
    round.ms = Date.now() - roundBegan;
    log.push(round);
    await Promise.resolve(o.onRound?.(round)).catch(() => undefined);

    if (verdict?.ok) { why = "done"; break; }
    if (!verdict) { why = "done"; break; } // no eye: one build is what we have, and it rendered
  }

  const script = scene ? scriptFor(scene) : "";
  const kept: Made["kept"] = {};
  if (preview) kept.preview = preview;
  if (scene && o.store) {
    const k = await keep(o.store, key("scene.py"), Buffer.from(script, "utf8"), "text/x-python");
    if (k) kept.script = k;
    const j = await keep(o.store, key("scene.json"), Buffer.from(JSON.stringify(scene), "utf8"), "application/json");
    if (j) kept.script = kept.script ?? j;
  }

  // ---- the real one, once the cheap one is right
  let mime: string | undefined;
  let ok = false;
  if (scene && why !== "budget" && why !== "model") {
    const moving = !!scene.move;
    const out = await o.render({
      script,
      move: moving,
      timeoutMs: o.finalMs ?? 1_800_000,
      ...(o.assets ? { assets: o.assets } : {}),
      ...(o.keepBlend ? { wantBlend: true } : {}),
    });
    if (out.ok) {
      const made: Shot | undefined = out.shots[0];
      if (made && o.store) {
        mime = made.mime;
        const k = await keep(o.store, key(moving ? "final.mp4" : "final.png"), made.bytes, made.mime);
        if (k) kept.final = k;
      } else if (made) mime = made.mime;
      if (out.blend && o.keepBlend && o.store) {
        const b = await keep(o.store, key("scene.blend"), out.blend, "application/octet-stream");
        if (b) kept.blend = b;
      }
      ok = !!made;
    } else {
      why = "render";
    }
  }

  // ---- the other sides of it: a still is one angle, and three angles of the same thing is what reads as 3D. Rendered at preview
  // quality (seconds each on a box with no graphics card), and only once the real one exists. A view that fails is left out.
  const wantViews = Math.max(0, Math.min(VIEWS.length, o.views ?? 2));
  if (ok && scene && !scene.move && wantViews) {
    const views: Kept[] = [];
    for (const v of VIEWS.slice(0, wantViews)) {
      const shot = await o.render({
        script: scriptFor(sideOf(scene, v)), move: false,
        timeoutMs: o.previewMs ?? 180_000, ...(o.assets ? { assets: o.assets } : {}),
      });
      const png = shot.ok ? shot.shots[0]?.bytes : undefined;
      if (png && o.store) {
        const k = await keep(o.store, key(`view-${views.length + 1}.png`), png, "image/png");
        if (k) views.push(k);
      }
    }
    if (views.length) kept.views = views;
  }

  return {
    ok,
    why,
    scene,
    script,
    rounds: log,
    kept,
    ...(brief ? { brief } : {}),
    ...(mime ? { mime } : {}),
    paise,
    ms: Date.now() - began,
  };
}
