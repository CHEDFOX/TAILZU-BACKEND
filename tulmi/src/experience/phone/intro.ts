/**
 * The intro: the opening film and how it is presented.
 */

import { type MediaPresent, type ScreenResponse, SDUI_SCHEMA_VERSION, type Node } from "../../../../shared/types/sdui.js";
import { landingScreenId } from "../bootstrap/startScreen.js";
import { type MediaEntry, getMediaRegistryFn, mediaSource } from "../mediaRegistry.js";
import type { ScreenContext } from "../screens.js";
import { FILL_STYLE } from "./layout.js";
import { navigationFor } from "./navigation.js";

/** Diameter of the intro plate — the in-app mic's own size, deliberately. */
const INTRO_PLATE = 128;
/** How long the intro holds before moving on. Match your file's length —
 *  a GIF reports nothing when it ends, so this timer IS the length of the
 *  opening. Env-driven so a new clip is one line in .env and a restart, not
 *  a code change. */
const INTRO_PLAY_MS = Number(process.env.INTRO_PLAY_MS ?? 2600);
/** How long the plate takes to be drawn into the mic. Part of INTRO_PLAY_MS,
 *  not added to it — the opening should not grow because it got nicer. */
/**
 * Play the intro even with no media uploaded, using the built-in mark.
 *
 * Set INTRO_BUILT_IN=false to go back to "no file, no intro".
 */
/** Safety net for a video that never reports completion — a refused codec, a
 *  file that never loads. The intro hides the header and the tabs, so without
 *  this there is no way off the screen at all.
 *
 *  5s, not 8: nothing is painted behind the media any more, so this is now how
 *  long a failed video shows BLACK before the app appears. The mic animation
 *  runs a couple of seconds and reports completion long before either number
 *  matters — this only ever bounds the failure. */
const INTRO_VIDEO_MAX_MS = Number(process.env.INTRO_VIDEO_MAX_MS ?? 5000);
export const INTRO_BUILT_IN = (process.env.INTRO_BUILT_IN ?? "true").toLowerCase() !== "false";
/** Round window on black. Shared by the player and its still fallback so the
 *  two can never drift apart. */
const PLATE_STYLE = {
  width: INTRO_PLATE,
  height: INTRO_PLATE,
  borderRadius: INTRO_PLATE / 2,
  backgroundColor: "#FFFFFF",
  overflow: "hidden" as const,
};

/**
 * How a piece of media is shown, resolved for one registry key.
 *
 * The shape of the window, how the media meets it, what is behind it, how long
 * the scene holds — none of that is a property of the file, and none of it
 * should need a deploy. The entry carries it (POST /v1/media/present), env
 * carries the fallback, and the numbers below are only what applies when
 * nobody has said otherwise.
 *
 * Defaults are full-bleed and cover: the opening media is cut 9:16 for exactly
 * that, and a tall phone is 9:19.5, so "contain" would letterbox the one screen
 * meant to be edge to edge. A clip that is NOT full-bleed by design gets
 * {"fit":"contain"}, or a shape of its own, over HTTP.
 */
interface Presented {
  style: Record<string, unknown>;
  fit: "cover" | "contain";
  holdMs: number | null;
  /**
   * The placement facts, forwarded to the media node as props.
   *
   * A NUDGE IS A PERCENTAGE OF THE WINDOW, and that is its limit. When the box
   * is fixed in points — which is the whole point of boxWidth, so the film's
   * mark can match a launch icon that cannot scale — the correction needed is
   * also a fixed number of points, and a percentage of a screen that changes
   * size cannot be that on more than one device. Right on a Pro Max, two
   * points out on an SE.
   *
   * These are the same two facts screenHero forwards: where the subject sits
   * in the art, and where it should land in the box. The client measures the
   * box it is actually drawing into and does the arithmetic there, so the
   * answer is exact on every device rather than on the one it was tuned for.
   */
  place: Record<string, number>;
  /**
   * What the media is matted on — so the SCREEN can be matted on it too.
   *
   * Art is rarely graded to pure black. This one is rgb(8,8,9), and on an OLED
   * that is not a near-miss: #000000 is the pixel off and #080809 is the pixel
   * faintly on. Painting the screen black and the media's own ground eight
   * values above it puts a hard edge exactly where the media stops, and the eye
   * finds an edge far more easily than it judges a shade.
   *
   * Invisible while the media was full bleed, because then its ground WAS the
   * screen and there was nothing to compare. Boxing it to a fixed size — to
   * match a launch icon that cannot scale — is what produced the surround, and
   * with it a grey rectangle floating on black.
   */
  background: string;
}

function presentMedia(entry: MediaEntry | undefined): Presented {
  const p: MediaPresent = entry?.present ?? {};
  // Forwarded untouched, and only when the upload declared them. `aspect` is
  // the switch: without the art's shape the client has nothing to compute and
  // keeps the centred `cover` it has always done.
  const place: Record<string, number> = {
    ...(p.aspect !== undefined ? { aspect: p.aspect } : {}),
    ...(p.focusX !== undefined ? { focusX: p.focusX } : {}),
    ...(p.focusY !== undefined ? { focusY: p.focusY } : {}),
    ...(p.anchorX !== undefined ? { anchorX: p.anchorX } : {}),
    ...(p.anchorY !== undefined ? { anchorY: p.anchorY } : {}),
  };
  const envShape = (process.env.INTRO_SHAPE ?? "").trim().toLowerCase();
  const shape = p.shape
    ?? (envShape === "plate" || envShape === "card" || envShape === "full" ? envShape : "full");
  const fit = p.fit
    ?? ((process.env.INTRO_FIT ?? "").trim().toLowerCase() === "contain" ? "contain" : "cover");
  const bg = p.background ?? "#000000";
  const inset = p.inset ?? 0;

  if (shape === "plate") {
    const d = p.size ?? INTRO_PLATE;
    return {
      fit,
      holdMs: p.holdMs ?? null,
      background: p.background ?? "#FFFFFF",
      place,
      style: {
        width: d, height: d, borderRadius: d / 2,
        backgroundColor: p.background ?? "#FFFFFF",
        overflow: "hidden" as const,
      },
    };
  }
  if (shape === "card") {
    return {
      fit,
      holdMs: p.holdMs ?? null,
      background: bg,
      place,
      style: {
        width: "100%",
        ...(p.size ? { maxWidth: p.size } : {}),
        aspectRatio: p.aspectRatio ?? 9 / 16,
        borderRadius: p.radius ?? 22,
        marginHorizontal: inset || 20,
        backgroundColor: bg,
        overflow: "hidden" as const,
      },
    };
  }
  // full — absolutely filling its parent. width/height only when there is no
  // inset: with edges pinned they are redundant, and together they fight.
  //
  // A NUDGE moves the whole window inside the screen, in percent. `cover`
  // centres the frame, and the subject of a frame is rarely at its centre —
  // the opening media's mark sits at (0.474, 0.471) of its own art, so cover
  // lands it left of and above the middle while the launch screen draws the
  // same mark dead centre. The jump between them is placement, not art.
  //
  // Percent because the miss scales: on a phone taller than the art, cover
  // scales the art to the screen's HEIGHT, so the offset grows with the
  // device. `top`/`left` percentages resolve against the parent's height and
  // width, so one pair of numbers is right on every screen.
  //
  // Right and bottom go: a box cannot be pinned to an edge and moved off it.
  // Size comes from the parent instead, origin from the nudge. What slides off
  // one edge is not visible arriving at the other — the screen behind is the
  // same black the media is matted on.
  //
  // SCALE shrinks that box, centred, before the nudge is applied — so a nudge
  // means the same thing at any scale. It is here for one reason: a launch
  // screen's icon is a fixed size compiled into the binary, and when the
  // opening film's subject comes out bigger than it, the film is the only side
  // that can move without a build. The right fix is the icon; this is the one
  // available today.
  // A BOX in points is the same idea taken all the way. A launch screen's icon
  // is 17pt on a mini and 17pt on a Pro Max; media under `cover` is a share of
  // the screen, so 17pt then 20pt. A percentage of a number that changes cannot
  // equal a number that does not — the two agree on one screen size and drift
  // on every other. Fixing the box in points puts both on the same ruler.
  //
  // Each axis decides for itself: a point size anchors at 50% and pulls back by
  // half its own size (the standard centring pair), a missing one keeps the
  // screen-relative behaviour above.
  const scale = p.scale !== undefined ? Math.min(1, Math.max(0.05, p.scale)) : 1;
  const boxed = p.boxWidth !== undefined || p.boxHeight !== undefined;
  const nudged = p.nudgeX !== undefined || p.nudgeY !== undefined || scale !== 1 || boxed;
  // Four decimals: enough to place a mark inside a pixel, short enough that the
  // served JSON reads as a number a person chose.
  const pct = (n: number) => `${Math.round(n * 1e4) / 1e4}%`;
  const round = (n: number) => Math.round(n * 100) / 100;
  const centred = ((1 - scale) / 2) * 100;
  /** One axis of the box: its size, where it starts, and any pull-back. */
  const axis = (points: number | undefined, nudge: number) =>
    points !== undefined
      ? { size: points, at: "50%", margin: round(-points / 2 + (nudge / 100) * points) }
      : { size: pct(scale * 100), at: pct(centred + nudge), margin: undefined };
  const x = axis(p.boxWidth, p.nudgeX ?? 0);
  const y = axis(p.boxHeight, p.nudgeY ?? 0);
  return {
    fit,
    holdMs: p.holdMs ?? null,
    background: bg,
    place,
    style: {
      position: "absolute" as const,
      ...(nudged
        ? {
            top: y.at, left: x.at,
            width: x.size, height: y.size,
            ...(x.margin !== undefined ? { marginLeft: x.margin } : {}),
            ...(y.margin !== undefined ? { marginTop: y.margin } : {}),
          }
        : {
            top: inset, left: inset, right: inset, bottom: inset,
            ...(inset ? {} : { width: "100%", height: "100%" }),
          }),
      ...(p.radius ? { borderRadius: p.radius } : {}),
      backgroundColor: bg,
      overflow: "hidden" as const,
    },
  };
}

export function introScreen(ctx: ScreenContext): ScreenResponse {
  // Route the post-intro destination the SAME way the bootstrap would when the
  // intro is NOT playing — so a brand-new (not-onboarded) user goes through
  // onboarding instead of being dropped straight on home (which skipped language
  // pick + keyboard-enable and never set onboarded=true → intro replayed forever).
  //
  // AND THE SAME WAY IT DECIDES WHICH TAB, which this did not do.
  //
  // "home" is the Train tab's screen, and it was handed straight to the
  // navigate. Every launch that played the film therefore landed on Train no
  // matter what the bootstrap had decided — the landing rule was applied in
  // one place and quietly bypassed in the other, so the app opened on Train,
  // was reported as opening on Train, and the fix kept going to the side that
  // was already right.
  //
  // landingScreenId only redirects a TAB ROOT, so "onboarding" passes through
  // it untouched and only "home" is turned into the tab that is actually being
  // landed on.
  const next = landingScreenId(
    navigationFor(!!ctx.personality?.shellSeenAt),
    ctx.onboarded ? "home" : "onboarding",
  );

  // The opening scene IS the in-app mic.
  //
  // Owner decision: the first thing the app shows is the thing the product is,
  // and it is already uploaded — so the intro reads the SAME media the in-app
  // mic wears, in the same preference order the mic uses, rather than asking
  // for a second upload of the same asset under a different key.
  //
  //   intro              — an explicit override, if someone ever wants a
  //                        different opening from the mic
  //   mic.animation      — the GIF
  //   mic.animation.mp4  — the video, only if there is no GIF
  //   (nothing)          — the built-in mark assembling itself
  //
  // The GIF is preferred here, and ONLY here. The in-app mic wants the mp4:
  // it can freeze on a frame between takes, which a GIF cannot. The intro
  // needs none of that — it plays once for two seconds and leaves — and the
  // GIF is drawn by expo-image, which is already carrying every other image in
  // the app. The mp4 needs expo-video, a separate native module, and a player
  // built through a hook. That is a lot of machinery to stake a first
  // impression on when the cheap path shows the same animation.
  const reg = getMediaRegistryFn?.() ?? {};
  const introKey =
    reg["intro"]?.url ? "intro"
    : reg["mic.animation"]?.url ? "mic.animation"
    : reg["mic.animation.mp4"]?.url ? "mic.animation.mp4"
    : null;
  const hasIntroMedia = !!introKey;
  // Send the RESOLVED url, not the key.
  //
  // A `{ key }` source makes the client look the key up in the media registry
  // it got from the bootstrap. That registry is module state on the client and
  // it is populated as the bootstrap lands — and the intro is the FIRST screen,
  // rendered at exactly that moment. Lose the race and resolveMedia returns
  // "empty", the player renders null, and the intro is a black hold. Which is
  // what it was.
  //
  // The server already has the url in hand, so there is nothing to look up.
  // `{ url, contentType }` resolves with no registry at all, and it is the
  // oldest branch of that resolver — so it works on every installed bundle,
  // including ones predating any of this.
  const introEntry = introKey ? reg[introKey] : undefined;
  const introSource = introEntry?.url
    ? mediaSource(introEntry.url, introEntry.contentType)
    : { key: introKey };
  // An mp4 needs a Video node; Image would render nothing for it. Decided from
  // the RESOLVED entry, not the key's name — an `intro` override can be a video
  // whatever it is called, and the stored contentType is the authority.
  const introIsVideo =
    (introEntry?.contentType ?? "").toLowerCase().startsWith("video/") ||
    /\.(mp4|mov|m4v|webm)(\?|$)/i.test(introEntry?.url ?? "");
  // Shape, fit and hold all come off the registry entry when it carries them.
  // Nothing below decides how this looks any more; it only decides which node
  // can play the file.
  const shown = presentMedia(introEntry);
  const holdMs = shown.holdMs ?? INTRO_PLAY_MS;
  // Only a still cut from THIS file — a replaced film waits for its own.
  const introPoster = introEntry?.poster && introEntry.poster.from === introEntry.url
    ? introEntry.poster : null;
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "intro",
    title: "",
    // hideChrome removes header + tab bar so the Slideshow fills the whole
    // window — critical for the intro to feel like a splash-adjacent
    // cinematic instead of "media inside the app's content area."
    hideChrome: true,
    state: {},
    actions: {
      // replace: the intro is a step in a sequence, not somewhere to return
      // to. Pushing left it under the permission screen, so an edge swipe from
      // there played the opening film again.
      done: { kind: "navigate", screenId: next, replace: true },
    },
    // Root is a flex View (Stack, not the ScrollView-based Screen). The
    // Slideshow gets width:100% + height:100% + flex:1 so it stretches to
    // fill the parent — which is now the whole window because chrome is
    // hidden.
    root: {
      type: "Stack",
      // NOTHING HERE TAKES A TOUCH, and that is the point of it.
      //
      // The whole frame used to be a press that skipped to the next screen. It
      // was there as the escape hatch for a screen with no header and no tab
      // bar, from when the media reported its own completion and might not.
      // The timer below owns the advance on every path now, so the hatch was
      // insurance against something that can no longer happen — and the cost
      // of it was that the opening ended under a thumb.
      //
      // A film four seconds long is four seconds someone is holding a phone.
      // A finger resting on the glass, a tap at the wrong moment, the hand
      // that is already moving toward where the first button will be: all of
      // them cut the one thing in the product that is supposed to be watched,
      // and none of them were a decision to skip it.
      //
      // Auto-advance owned by the SCREEN, on every path.
      //
      // `delay` + `navigate` are core actions, so this works on any client
      // build. It used to be skipped for the image path, which was left to the
      // Slideshow's own onComplete — but this screen hides the header and the
      // tab bar, so a component that renders and then never reports finishing
      // strands the user with no way off at all. Nothing here depends on a
      // component reporting anything any more.
      on: {
        onAppear: { kind: "sequence", actions: [
          // Video gets a longer leash: it is the one path that can still report
          // its own completion, so this is only the net for a clip that never
          // loads, and cutting a playing video short is worse than a beat of
          // extra black.
          // The morph's length comes OUT of the hold, so the opening still
          // lasts what INTRO_PLAY_MS says rather than that plus an animation.
          { kind: "delay", ms: introIsVideo ? (shown.holdMs ?? INTRO_VIDEO_MAX_MS) : holdMs },
          // Draw the plate into the mic, then navigate. Inlined rather than
          // named: a sequence entry is an action, and no action kind calls
          // another by name.
          { kind: "navigate", screenId: next, replace: true },
        ] },
      },
      style: {
        flex: 1,
        width: "100%",
        height: "100%",
        // THE SAME GROUND THE MEDIA IS MATTED ON, not black by assumption.
        //
        // This art is graded to rgb(8,8,9). On an OLED that is not a near-miss
        // to #000000 — black is the pixel off, and eight values is the pixel
        // faintly on — so a black screen behind it drew a hard edge exactly
        // where the media stopped, and the reveal read as a grey panel floating
        // on a darker screen.
        //
        // It did not show while the media was full bleed: its ground was the
        // screen, and there was no surround to compare against. Boxing it to a
        // fixed size, to match a launch icon that cannot scale, is what created
        // the surround and with it the edge.
        //
        // One value now, from the entry, painting both the window and what is
        // around it. Set `background` on the media and the screen follows —
        // they cannot disagree, because there is only one of them.
        backgroundColor: shown.background,
        // Center the small media in the middle of the window.
        alignItems: "center",
        justifyContent: "center",
      },
      children: [
        // No file uploaded: play the brand mark assembling itself, in the same
        // circular plate the uploaded media would have filled. It is the
        // keyboard's own mic animation, so the first thing the app shows is the
        // thing the product is — and an upload to the "intro" key replaces it
        // without touching this tree.
        ...(hasIntroMedia ? [] : [{
          type: "ParticleMark",
          style: PLATE_STYLE,
          // ParticleMark loops forever and reports nothing — its animation runs
          // in a UI-thread worklet. So the SCREEN owns the timing (see the
          // root's onAppear) rather than waiting on an onComplete that will
          // never arrive. Getting this wrong strands the user on a black
          // window with no header and no tabs to leave by.
          // The particles' colour, named rather than left to the component's
          // default (which was amber): ink, because the plate here is white.
          props: { background: "#FFFFFF", circular: true, color: "#1B1712" },
        } as Node]),
        // NOTHING is painted under the media.
        //
        // The mark used to sit behind it as a blank-screen guard, for the case
        // where a key's file has gone or the device refuses the codec. But the
        // guard is visible in the normal case too: the mark's particles play
        // while the video loads, so the opening read as two animations, one
        // after the other, when it should be one.
        //
        // Owner decision: the opening is the in-app mic and nothing else. A
        // missing file now shows black for the hold rather than a second
        // animation — the timer below still carries the user through to the
        // app either way, so the failure costs a beat, not a trap.
        // Video path — an uploaded mp4 (what the mic prefers).
        // THE FILM'S OWN FIRST FRAME, under the film. The server cuts it
        // (routes/media.ts ensureVideoPosters) and the app's splash wait
        // prefetches it with the screen's other images, so it is on disk
        // before the launch image lifts. The film's box is then transparent
        // until its first frame lands on top of the same picture — where it
        // used to be the bare ground for those moments, which was the blink.
        ...(hasIntroMedia && introIsVideo && introPoster ? [{
          type: "Image",
          style: shown.style,
          props: {
            source: mediaSource(introPoster.url, introPoster.contentType),
            contentFit: shown.fit,
            ...shown.place,
          },
        } as Node] : []),
        ...(hasIntroMedia && introIsVideo ? [{
          type: "Video",
          style: introPoster ? { ...shown.style, backgroundColor: "transparent" } : shown.style,
          props: {
            source: introSource,
            autoplay: true, loop: false, muted: true, contentFit: shown.fit,
            // Where the mark is in the film, and where it must land in the box.
            // Without these the box is centred and the mark is wherever the art
            // put it — which is what the launch screen never agrees with.
            ...shown.place,
          },
          on: { onComplete: "done" },
          // THE SPLASH WAITS FOR THE FILM.
          //
          // Before it lifts, the app downloads the opening's first remote
          // picture: on a first launch every file on the screen, on every
          // later launch only an Image's. A Video is not an Image, so on a
          // later launch the splash lifted as soon as the screen existed,
          // before the film had loaded, and the ground showed for a beat:
          // the mark vanished and came back. That is the blink.
          //
          // This fallback names the film itself, so every launch waits on the
          // film's download, as a first launch always did (which is why a
          // first launch was seamless). It is never drawn: every installed
          // build has Video. No state and no timers, deliberately: the first
          // screen is rebuilt when the fresh copy replaces the cached one,
          // and anything keyed to its state is lost in that swap.
          fallback: {
            type: "Image",
            style: FILL_STYLE,
            props: { source: introSource, contentFit: shown.fit },
          },
        } as Node] : []),
        // Image path — a GIF, drawn by expo-image, which plays it natively.
        //
        // This was a single-frame Slideshow, which existed only to own the
        // timing. The screen owns that now, so the extra component bought
        // nothing and cost a dependency: a bundle without Slideshow renders an
        // unknown node, and an unknown node draws nothing.
        //
        // Image is the most basic node there is. Every bundle that can render
        // this app at all can render it.
        ...(hasIntroMedia && !introIsVideo ? [{
          // The plate: a white circle the size of the in-app mic, clipping the
          // media to a round window. Same shape and size the user will be
          // tapping every day.
          //
          // The plate is a VIEW wrapping the image, not the image's own style.
          // `overflow: hidden` clips a view's CHILDREN; on an image element the
          // pixels are the element itself, so the round corners had nothing to
          // cut and the media drew square.
          //
          // NO EXIT ANIMATION. The plate holds and the screen changes.
          //
          // It carried a collapse, on the idea that the intro and the in-app
          // mic are one object being handed from one screen to the other. The
          // mic turned out to be a 38pt control on the edge of a scrolling
          // page — nothing to hand anything to — and every version of the move
          // read as an object dying rather than arriving. A straight cut is
          // honest, and the opening media is being replaced anyway; whatever
          // replaces it can bring its own exit if it wants one.
          type: "Stack",
          // No dx/dy: the plate collapses where it stands. It used to aim
          // 70pt down at the in-app mic, and the in-app mic is a 38pt control
          // on the right edge of a text box partway down a scrolling page —
          // a destination no fixed offset can find. A move toward a target it
          // cannot reach is what made this read as cheap; a centred collapse
          // is a decision rather than a miss. toScale 0 so the last thing on
          // screen is the move finishing, not a dot being cut off.
          style: shown.style,
          children: [{
            type: "Image",
            style: FILL_STYLE,
            props: { source: introSource, contentFit: shown.fit, ...shown.place },
          } as Node],
          fallback: {
            type: "Stack",
            style: shown.style,
            children: [{
              type: "Image",
              style: FILL_STYLE,
              props: { source: introSource, contentFit: shown.fit, ...shown.place },
            }],
          },
        } as Node] : []),
      ],
    },
    cacheTtlSeconds: 60,
  };
}
