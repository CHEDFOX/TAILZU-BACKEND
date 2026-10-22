/**
 * Written by scripts/make-blip-loops.ts: do not edit. The version is in every
 * picture's URL (blipLoops.ts), so a changed picture is a new URL; the sizes
 * are in points, so a screen lays each out at its true size.
 */
export const BLIP_BUILD: { v: number; frames: number; frameMs: number; files: Record<string, { w: number; h: number; bytes: number }> } = {
  v: 1, frames: 20, frameMs: 100,
  files: {
    "wave-l": { w: 121, h: 159, bytes: 78356 },
    "tada-l": { w: 121, h: 159, bytes: 151268 },
    "listen-s": { w: 106, h: 115, bytes: 116246 },
    "tap-s": { w: 106, h: 115, bytes: 93380 },
    "present-s": { w: 106, h: 115, bytes: 91384 },
    "tada-s": { w: 106, h: 115, bytes: 102892 },
    "pointd-s": { w: 106, h: 115, bytes: 93460 },
    "thumbs-s": { w: 106, h: 115, bytes: 93486 },
    "carry-s": { w: 106, h: 115, bytes: 113042 },
    "think-s": { w: 106, h: 115, bytes: 87924 },
  },
};
