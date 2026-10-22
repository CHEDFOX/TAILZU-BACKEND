/**
 * BLIP, AS ANIMATED PICTURES, FOR THE BUILDS THAT CANNOT DRAW HIM THEMSELVES.
 *
 * The new onboarding draws Blip with a persistent overlay (OnboardStage,
 * BlipSpot). The builds in the stores do not have either, but every build has
 * an Image, and the Image animates a WebP. So each pose Blip takes in a step is
 * a short transparent loop of the same drawing (the desktop's blip.js walker,
 * cut by scripts/make-blip-loops.ts), served from /blip/ the way the typefaces
 * are served from /fonts/ (server.ts), and shipped in the image (tulmi/blip).
 *
 * The names are `<pose>-<size>`: the pose is blip.js's own word for it, the
 * size is `s` (a step's head, 100 points tall) or `l` (Welcome and Done, 190).
 * blipData.ts is the script's output: the version in the URLs and each
 * picture's size in points, so a screen lays a picture out at its true size.
 */
import { BLIP_BUILD } from "./blipData.js";

export type BlipSize = "s" | "l";

/** How tall Blip is drawn in each size, in points. */
export const BLIP_HEIGHT: Record<BlipSize, number> = { s: 100, l: 140 };

/** Every loop that is made: the poses a store-build step takes, and in which size. */
export const BLIP_LOOPS = [
  "wave-l", "tada-l",
  "listen-s", "tap-s", "present-s", "tada-s", "pointd-s", "thumbs-s", "carry-s", "think-s",
] as const;
export type BlipLoop = (typeof BLIP_LOOPS)[number];

/** One loop's length (ms): every motion in it repeats a whole number of times in it. */
export const BLIP_LOOP_MS = 2000;

/** Where the pictures are served: the same origin as the typefaces and the media. */
const blipBase = (): string => `${process.env.PUBLIC_ORIGIN || "https://api.tailzu.space"}/blip/`;

export function blipUrl(loop: BlipLoop): string {
  return `${blipBase()}${loop}.webp?v=${BLIP_BUILD.v}`;
}

/** A loop's size in points. */
export function blipSize(loop: BlipLoop): { w: number; h: number } {
  const f = BLIP_BUILD.files[loop];
  // The script wrote every loop it makes; a loop it did not make is a typo here.
  if (!f) throw new Error(`no Blip loop ${loop}`);
  return { w: f.w, h: f.h };
}
