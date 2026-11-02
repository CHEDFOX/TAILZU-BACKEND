/**
 * Flow armed: the screen that holds the mic open for the keyboard.
 */

import { type ScreenResponse, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { FLOW_IDLE_TIMEOUT_MS } from "../flow.js";
import { getMediaRegistryFn } from "../mediaRegistry.js";
import type { ScreenContext } from "../screens.js";
import { screenHero } from "./hero.js";

/** How long the "Flow is on" confirmation stays before it leaves by itself. */
const FLOW_ARM_DISMISS_MS = Number(process.env.FLOW_ARM_DISMISS_MS ?? 4200);
/**
 * How long the clip's LAST frame is held before the screen closes.
 *
 * A demo that cuts on its final frame teaches nothing — the thing being
 * demonstrated is the state it ends in, and that state needs a beat to be
 * read. Overridable per upload as present.endHoldMs.
 */
const FLOW_END_HOLD_MS = Number(process.env.FLOW_END_HOLD_MS ?? 1200);

/**
 * Flow arming screen — the ONE-TIME hop the keyboard mic makes to turn on the
 * background-audio "Flow Session" (kb.mic.mode="flow", the Wispr model). On
 * appear it requests mic permission (required for the background session) and
 * arms the session; after that it's just a "swipe back and dictate" prompt.
 * Once the user swipes back, dictations run from the keyboard without returning
 * here until the session idles out (kb.flow.idleTimeoutMs). Fully
 * backend-authored — restyle/recopy freely, it's pure SDUI.
 */
/**
 * How long the Flow confirmation stays.
 *
 * With a clip: its full length plus a beat to take in the last frame, because
 * a demo cut off mid-play teaches nothing and looks broken. Without one: long
 * enough to read two lines. Capped either way — this screen is a handoff, and
 * a handoff that outstays its welcome is a wait.
 */
function flowDismissMs(): number {
  const entry = getMediaRegistryFn?.()?.["hero.flow_arm"];
  // The upload says how long the screen lasts, in order of how much it knows:
  //
  //   present.holdMs  — someone said so, over HTTP. Ends the argument.
  //   durationMs      — the compressor measured the clip. One play, plus a
  //                     beat to read the last frame on.
  //   the default     — no clip, or nothing has measured it yet.
  //
  // holdMs is here because a bare upload carries no duration: only the
  // compressor probes that, so a clip that never needed compressing left this
  // screen sitting on a default while a one-second film looped four times
  // underneath it and got cut mid-play.
  // holdMs ends the argument: someone said how long, over HTTP.
  const hold = entry?.present?.holdMs;
  if (hold) return Math.min(hold, 20_000);
  const clip = entry?.durationMs;
  if (!clip) return FLOW_ARM_DISMISS_MS;
  /**
   * THE SCREEN LASTS AS LONG AS THE THREE THINGS IT DOES.
   *
   *   startDelayMs   hold the first frame, so the screen arrives on a still
   *                  rather than mid-motion
   *   durationMs     play it once — the clip does not loop here, so it comes
   *                  to rest on its last frame rather than snapping back
   *   endHoldMs      hold THAT frame, so the thing being demonstrated is the
   *                  last thing seen and not a cut
   *
   * Added, not guessed. The old rule was `clip + 900` with a floor, which
   * ignored the lead-in entirely: a clip told to wait two seconds and then play
   * for one had its screen dismissed at 4.2s by a floor that happened to be
   * long enough, and would have been cut mid-play the moment either number
   * moved. A screen whose length is a coincidence is a screen that breaks when
   * someone edits the film.
   */
  const start = Math.max(0, Number(entry?.present?.startDelayMs ?? 0));
  const endHold = Math.max(0, Number(entry?.present?.endHoldMs ?? FLOW_END_HOLD_MS));
  return Math.min(Math.max(start + clip + endHold, FLOW_ARM_DISMISS_MS), 20_000);
}

export function flowArmScreen(_ctx: ScreenContext): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "flow_arm",
    title: "",
    // No tabs, no header. This screen exists for a few seconds between the
    // keyboard and the user's own app; a tab bar invites them to go somewhere
    // else, which is the one thing it must not do.
    hideChrome: true,
    state: { armed: false },
    actions: {
      // Fired on appear: get mic permission, then arm the background session.
      arm: {
        kind: "requestPermission",
        permission: "microphone",
        onGranted: "doArm",
        onDenied: "micDenied",
      },
      doArm: {
        kind: "sequence",
        actions: [
          { kind: "armFlowSession", idleTimeoutMs: FLOW_IDLE_TIMEOUT_MS },
          { kind: "setState", path: "armed", value: true },
          { kind: "haptic", style: "success" },
          // Then leave on its own. The session is armed the moment
          // armFlowSession returns — everything after that is confirmation,
          // and confirmation the user has to dismiss is a chore. Long enough
          // to read the line and watch the clip once; short enough that
          // nobody waits on it.
          // Wait for the clip, not for a guess. The screen used to leave after
          // a fixed 4.2s and cut its own demo off mid-play — the one thing a
          // demo must not do. When the compressor has measured the clip, that
          // length plus a beat is the delay; with no clip, the short default.
          { kind: "delay", ms: flowDismissMs() },
          // Home, not back. This screen is usually reached from the keyboard
          // while the user is inside another app, so "back" is whatever the
          // app happened to be showing before — and on a fresh launch that is
          // the intro, which is not a place to be returned to. Naming the
          // destination makes the exit the same every time.
          { kind: "navigate", screenId: "stats" },
        ],
      },
      micDenied: {
        kind: "sequence",
        actions: [
          { kind: "toast", tone: "error",
            message: "Allow the microphone in Settings, then tap the keyboard mic again." },
          // AND LEAVE. This screen hides the header and the tab bar and is
          // entered as the only stack entry, so there is no back gesture
          // either — a toast on its own left the user on a black screen with
          // nothing to tap and force-quit as the only way out.
          { kind: "delay", ms: 2600 },
          { kind: "navigate", screenId: "stats" },
        ],
      },
      micDeniedToastOnly: {
        kind: "toast",
        tone: "error",
        // No platform path: the two systems put this in different places, and
        // a toast that names the wrong one is worse than a toast that names
        // none. Short enough to read before it goes.
        message: "Allow the microphone in Settings, then tap the keyboard mic again.",
      },
    },
    root: {
      type: "Stack",
      on: { onAppear: "arm" },
      // A STACK, not a Screen.
      //
      // Screen is a ScrollView, and an absolutely positioned child of one is
      // placed against the CONTENT, not the window — fine while the content
      // happens to be exactly a screen tall, wrong the moment it is not. The
      // clip fills the window now, so the root has to be a plain box with a
      // real height. Same shape the intro uses, for the same reason. There is
      // nothing to scroll here: four seconds, no header, no tabs.
      style: {
        flex: 1, width: "100%", height: "100%",
        backgroundColor: "#000000",
        paddingHorizontal: 28, paddingTop: 72, paddingBottom: 0,
        alignItems: "center",
      },
      children: [
        // The clip, behind everything. FIRST in the list, because later
        // siblings paint on top — the same ordering rule that put a button
        // under the opening media until it was moved.
        // fullBleed / fullBleedTop are this screen's own padding, handed to the
        // backdrop so it can cancel them — an absolute child is laid out inside
        // the parent's padding, and a backdrop that respects padding is a
        // rectangle, not a backdrop.
        //
        // NO onlyOn. It said "ios" because Flow itself is iOS-only, which is
        // true of the FEATURE and not of this screen: whatever reaches here has
        // already been routed by a client that decided Flow applies. A platform
        // filter on the art could only ever subtract, and the one thing it
        // reliably subtracted was the art.
        // FIT BY WIDTH, HELD AT THE BOTTOM.
        //
        // The clip is a keyboard on black, reaching nearly the full width of a
        // 9:16 frame. No phone is 9:16: every one is taller, so "cover" scales
        // to the height and takes about a tenth of the width off each side —
        // the outer column of keys, on every device. A focal point cannot save
        // that, because what has to survive IS the full width.
        //
        // So the box takes the screen's width and the clip's own shape, and
        // nothing is cropped. What is left above it is this screen's black,
        // which is the clip's own ground — the join is invisible, and the
        // keyboard sits on the bottom of the screen the way a keyboard does.
        // Both values are overridable from the upload, so the next clip that
        // wants the old behaviour is a POST and not a deploy.
        // ARRIVE ON A STILL, PLAY ONCE, REST ON THE LAST FRAME.
        //
        // The three phases the screen's own length is computed from — see
        // flowDismissMs(). loop:false is what makes the third one possible: a
        // looping clip has no final state to hold, it just starts again.
        //
        // The lead-in itself is an upload value (present.startDelayMs), because
        // how long to wait before moving depends on the film.
        ...screenHero("flow_arm", {
          behind: true, fill: "width", pin: "bottom", loop: false,
          fullBleed: 28, fullBleedTop: 72,
        }),
        {
          type: "Heading",
          // "Flow is on" states a setting. This states what the user just
          // gained, in their terms: the microphone stops belonging to this app
          // and starts following them into every other one. That is the whole
          // feature, and it is a better sentence than its own name.
          props: { content: "The mic goes with you." },
          style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 14, textAlign: "center" },
        },
        {
          // One line, because the screen lasts four seconds. The old copy was
          // 27 words explaining a feature the user has just switched on — by
          // the time it was read it was gone. This says only what changed and
          // what to do with it, in the shape of the action itself.
          type: "Paragraph",
          props: { content: "Tap the mic in any app and talk — the words land written." },
          style: { textAlign: "center", marginBottom: 4, color: "$color.muted" },
        },
        // A square demo of Flow in use, below the instruction rather than
        // above it: this screen's whole job is to send the user back to their
        // app, so nothing may sit between them and that line. The clip shows
        // what happens AFTER they leave, which is exactly what a person
        // hesitating at "swipe back" wants to see.
        //
        // iOS only, because Flow is. The Android keyboard has its own capture
        // path and never reaches this screen.
        // FULL WIDTH, WHOLE CLIP, AT THE BOTTOM.
        //
        // It was a fixed 460pt box with contentFit "cover", and the clip is
        // 1:1 — so the box was taller than the clip is shaped, cover scaled it
        // up until it filled that height, and everything outside the box got
        // cropped. That is the zoom: not a zoom setting anywhere, just a box
        // the wrong shape and a fit rule that resolves the mismatch by
        // cutting. Cropping a DEMO removes the thing being demonstrated.
        //
        // aspectRatio 1 gives the box the clip's own shape at whatever width
        // the device is, so there is nothing left to crop, and "contain"
        // guarantees it even if the clip is not exactly square.
        //
        // The spacer grows instead of measuring: a fixed 44 put the clip
        // wherever the text happened to end. flex:1 puts it against the bottom
        // on every screen size, with a floor so it never collides on a small
        // one.
        { type: "Spacer", style: { flex: 1, minHeight: 24 } },
              ],
    },
  };
}
