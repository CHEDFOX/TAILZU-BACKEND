/**
 * BLIP, FOR THE BOTS APP: every bot's head, and Blip's whole body for the big moments.
 *
 * The pictures are PNGs cut from the design's dithered drawing by scripts/make-bots-art.ts and served the
 * way the onboarding's loops are: shipped in the image (tulmi/blip/bots), from /blip/ (server.ts), immutable,
 * with ?v= in the URL so a changed picture is a new file to the apps' caches. Raise ART_V when one changes.
 *
 * Blip's whole body MOVES: kit.blip(pose) draws the pose's animated loop (../blipLoops.ts, the onboarding's own,
 * an animated WebP every build's Image plays), chosen by blipLoopFor(). The still PNGs (blipUrl) stay for anything
 * that needs a still; neither renderer has a Reduce Motion source for an Image, so the loop is drawn there too,
 * exactly as the onboarding draws it.
 *
 * A bot's head is the same head recoloured in the bot's own colour. A person's own bot has no head of its own:
 * it is a circle in its colour with a white line icon (kit.botAvatar).
 */
import type { BlipLoop } from "../blipLoops.js";

export const ART_V = 1;

/** The heads that exist, and the colour each was cut in. The keys are the built-in bots' slugs, and "tailzu". */
export const BOT_INK = {
  tailzu: "#0a0a0a",
  keybot: "#A9573A",
  code: "#4F7A3A",
  plan: "#8F6A1F",
  travel: "#3E6E8E",
} as const;
export type HeadKey = keyof typeof BOT_INK;

/** Blip's poses, whole body: hello (welcome), listen, think (working), needs (needs you), done. */
export const BLIP_POSES = ["hello", "listen", "think", "needs", "done"] as const;
export type BlipPose = (typeof BLIP_POSES)[number];

/** The body pictures' own proportions (522 x 600 px). */
export const BLIP_BODY_RATIO = 522 / 600;

const origin = (): string => process.env.PUBLIC_ORIGIN || "https://api.x0bot.com";

/** A bot's head, or undefined for a bot that has none (a person's own). */
export function headUrl(key: string): string | undefined {
  return key in BOT_INK ? `${origin()}/blip/bots/head-${key}.png?v=${ART_V}` : undefined;
}

/**
 * The loop that plays a pose: hello waves, listen listens, think thinks, needs holds a hand out to you (present),
 * done cheers (tada). A loop comes in one size or two (`s` cut 115 pt tall, `l` 159): the bigger cut for a big Blip.
 */
export function blipLoopFor(pose: BlipPose, height: number): BlipLoop {
  switch (pose) {
    case "hello": return "wave-l";
    case "listen": return "listen-s";
    case "think": return "think-s";
    case "needs": return "present-s";
    case "done": return height > 130 ? "tada-l" : "tada-s";
  }
}

/** Blip's whole body in a pose, as a still. */
export function blipUrl(pose: BlipPose): string {
  return `${origin()}/blip/bots/${pose}.png?v=${ART_V}`;
}
