/**
 * The first run's afterSignIn screen.
 */

import type { Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { type BlipPose, blip, type BotsCtx, C, when, col } from "../../kit.js";
import { readyStep } from "./readyStep.js";
import { type Pose, type Figure, respond } from "./parts.js";

/** The same pose as the kit's picture of him, for a build that draws no stage. */
const KIT_POSE: Record<Pose, BlipPose> = { wave: "hello", listen: "listen", wait: "listen", think: "think", present: "needs", tada: "done" };

/** An empty box the apps measure; Blip is drawn above it, by them. No words: the boards give him none. */
export const onStage: Figure = (pose, h) => ({ type: "BlipSpot", props: { pose, h, say: "", bubble: "side" } });
const asPicture: Figure = (pose, h) => blip(KIT_POSE[pose], h);

/** Does this build draw the onboarding's stage and its one Blip? (Every BotsKit build so far does.) */
const staged = (ctx: BotsCtx): boolean => ctx.can.has("OnboardStage") && ctx.can.has("BlipSpot");
export const figureFor = (ctx: BotsCtx): Figure => (staged(ctx) ? onStage : asPicture);

/**
 * The stage's look, the same on both sides of sign-in so nothing changes at the boundary: white, no bar (drawn
 * transparent), Blip in the onboarding's own colours (the kit's pictures of him are cut from the same drawing), no
 * bubble (he says nothing), a short glide. Reduce Motion is the apps' to apply.
 */
const STAGE_LOOK = {
  // Sentences, not titles: the capitalising pass leaves them be.
  keepCase: true,
  ground: C.paper,
  progress: { on: "transparent", off: "transparent", height: 1, gap: 0 },
  blip: { dot: "#F3E2C6", sticker: "#151311", glow: "#39FF14" },
  // Never shown (no words); its ground is the paper the window's walker draws him against.
  bubble: { background: C.paper, border: C.ink, ink: C.ink, font: "Tailzu Hand", size: 17, bigSize: 19 },
  glide: { slide: 18, outMs: 200, inMs: 260, inDelayMs: 40 },
};
/** The run's steps, for the stages' `first` / `of`: Welcome and Sign in, Code, Name. */
const RUN_STEPS = 3;

/** An OnboardStage in the run's look: one Blip walks from spot to spot across it, and on into the next stage. */
export function stageNode(id: string, first: number, steps: Node[], extra: Record<string, unknown> = {}): Node {
  return { type: "OnboardStage", bind: { step: "step" }, props: { id, first, of: RUN_STEPS, ...STAGE_LOOK, ...extra }, children: steps };
}

/**
 * A screen of stage steps: the stage itself for a build that draws it, else the steps one at a time by the same
 * `step`, in the frame a page has (the safe area and a scrolling body on the phone, the whole window in one).
 */
export function stageScreen(ctx: BotsCtx, o: { title: string; id: string; first: number; steps: Node[]; state?: Record<string, unknown> }): ScreenResponse {
  const state = { step: 0, ...o.state };
  if (staged(ctx)) return respond(ctx, o.title, stageNode(o.id, o.first, o.steps), state);
  const shown = o.steps.length > 1 ? o.steps.map((s, i) => when({ eq: ["step", i] }, s)) : o.steps;
  if (ctx.client === "desktop") {
    return respond(ctx, o.title, col([col(shown, { minHeight: "100%", paddingTop: 44 })], { height: "100%", overflowY: "auto", backgroundColor: C.paper }), state);
  }
  return respond(ctx, o.title, {
    type: "SafeArea",
    props: { edges: ["top", "bottom"], barStyle: "dark-content" },
    style: { flex: 1, flexDirection: "column", backgroundColor: C.paper },
    children: [{ type: "Screen", props: { paddingBottom: 0 }, style: { backgroundColor: C.paper, paddingTop: 22, flexGrow: 1 }, children: shown }],
  }, state);
}

// ===================================================================== the stage after sign-in

/**
 * bots.name-it: the last step, on the stage Blip walks on to from the gate's (id "bots.first"): they are in, and Start.
 * Nothing is typed or asked here (readyStep.ts); the id stays so the apps that open it need no change.
 */
export function afterSignIn(ctx: BotsCtx): ScreenResponse {
  const fig = figureFor(ctx);
  return stageScreen(ctx, {
    title: "Start", id: "bots.first", first: 2,
    steps: [readyStep(ctx, fig)],
    state: { step: 0 },
  });
}
