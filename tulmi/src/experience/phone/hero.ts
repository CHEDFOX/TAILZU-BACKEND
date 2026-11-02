/**
 * The hero media at the top of a screen: its slot, its style and its overrides.
 */

import type { Node, MediaPresent } from "../../../../shared/types/sdui.js";
import { getMediaRegistryFn, mediaSrc, type MediaEntry, mediaKeyFor } from "../mediaRegistry.js";
import { FILL_STYLE } from "./layout.js";

/**
 * State key a delayed hero clip is bound to.
 *
 * NO SCREEN HAS TO DECLARE IT. The node carries `playing: false` as a literal
 * and binds this key on top; an unset key resolves to undefined and the
 * renderer keeps the literal, so the clip holds its still. The delay's setState
 * then writes true and the bind takes over.
 *
 * The first version of this did require every hosting screen to seed the key,
 * because a bind used to overwrite the literal with undefined — so forgetting
 * it in one screen produced a video with `playing: undefined`, falling through
 * to `autoplay: false`, which is a clip that never starts and says nothing
 * about why. Which screens host a hero is decided by an UPLOAD, so that list
 * could never be got right from here anyway.
 */
const HERO_PLAY_KEY = "_heroPlaying";

export function screenHero(
  screenId: string,
  opts: {
    height?: number;
    width?: number | string;
    radius?: number;
    /** Cancel this much side padding so the art reaches the screen edges. */
    fullBleed?: number;
    /** Cancel this much of the screen's top padding as well. */
    fullBleedTop?: number;
    /** Show only on this platform. The condition is evaluated on the device,
     *  so a per-platform slot needs no server-side detection. */
    onlyOn?: "ios" | "android";
    /**
     * How the media fills its box. "cover" (default) crops to fill — right for
     * a banner, where the edges are decoration. "contain" never crops — right
     * for a DEMO, where the cropped-off part is the thing being demonstrated.
     */
    fit?: "cover" | "contain";
    /**
     * Give the box the clip's own shape instead of a fixed height.
     *
     * A fixed height is a guess about the screen's width, and on any device
     * where the guess is wrong the media is either cropped or letterboxed. An
     * aspect ratio is the same statement made correctly: the box is as tall as
     * its own width times this, whatever that width turns out to be.
     */
    aspectRatio?: number;
    /** Space below the media. 0 sits it flush against the screen's bottom. */
    marginBottom?: number;
    /**
     * Fill the whole screen, behind everything else.
     *
     * A hero normally sits IN the column and cancels its padding. A 9:16 clip
     * at full width is taller than what is left of the screen once a heading
     * and a paragraph have had their share, so "full bleed" for one of those
     * can only mean behind the text, not below it. Put this first in children
     * and later siblings paint over it.
     */
    behind?: boolean;
    /**
     * Which axis the art is made to fit, with `behind`. See MediaPresent.fill:
     * "window" crops whatever overflows, "width" and "height" crop nothing and
     * leave the screen's own ground in the remainder. The upload overrides
     * this, so a clip that needs the other rule is one POST and no deploy.
     */
    fill?: "window" | "width" | "height";
    /** Which edge the box is held against when `fill` leaves a remainder. */
    pin?: "top" | "bottom" | "center";
    /**
     * Whether a clip repeats. Default true — a hero is ambient. A DEMO sets
     * false, so it comes to rest on its last frame instead of snapping back to
     * the first, which is what makes "hold the final state" possible at all.
     */
    loop?: boolean;
    /**
     * WHAT FILLS THE BOX WHEN NOTHING HAS BEEN UPLOADED.
     *
     * An empty slot is normally right: a screen with no art should look
     * deliberate rather than reserve a hole. That stops being true the moment
     * the art is the screen — a full-bleed paywall whose media key is empty is
     * not an undressed screen, it is a black one, and it stays black until
     * somebody remembers to upload something.
     *
     * So a screen whose art carries the argument names a built-in here, and
     * the uploaded file replaces it rather than turning it on. Same contract
     * the hero slots have always had: override, then upload, then built-in.
     */
    builtIn?: Node;
    /** Prefer `hero.<screen>.desktop` when one has been uploaded. */
    desktop?: boolean;
  } = {},
): Node[] {
  /**
   * A LANDSCAPE UPLOAD FOR A LANDSCAPE SCREEN.
   *
   * `hero.<screen>.desktop` is preferred for a window and falls back to the
   * shared key, which is what every install has. Art composed for a portrait
   * phone and art composed for a window are different pictures — a hand rising
   * from the bottom of a 16:9 frame with the offer beside it does not survive
   * being cropped into a phone, and the phone's does not fill a window.
   *
   * Same rule the sign-in backdrop follows, for the same reason.
   */
  const reg = getMediaRegistryFn?.();
  const key = `hero.${screenId}`;
  const entry = (opts.desktop ? reg?.[`${key}.desktop`] : undefined) ?? reg?.[key];
  if (!entry?.url) {
    if (!opts.builtIn) return [];
    // The built-in gets the same box the upload would have had, so swapping
    // one for the other changes what is drawn and not where.
    return [{
      type: "Stack",
      ...(opts.onlyOn ? { visibleIf: { platform: opts.onlyOn } } : {}),
      style: opts.behind
        ? {
            position: "absolute",
            top: opts.fullBleedTop ? -opts.fullBleedTop : 0,
            left: opts.fullBleed ? -opts.fullBleed : 0,
            right: opts.fullBleed ? -opts.fullBleed : 0,
            bottom: 0,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }
        : {
            ...(opts.aspectRatio
              ? { aspectRatio: opts.aspectRatio }
              : { height: opts.height ?? 148 }),
            ...(opts.width ? { width: opts.width, alignSelf: "center" } : {}),
            borderRadius: opts.radius ?? 20,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: opts.marginBottom ?? (opts.fullBleed ? 26 : 18),
          },
      children: [opts.builtIn],
    } as Node];
  }
  // A video needs a Video node — Image renders nothing for an mp4, which is
  // the failure that kept the intro black. Decided from the stored
  // contentType, so uploading a video to a slot that had a still just works.
  const isVideo =
    (entry.contentType ?? "").toLowerCase().startsWith("video/") ||
    /\.(mp4|mov|m4v|webm)(\?|$)/i.test(entry.url);
  // Whatever the call site asked for is the default; the entry overrides it.
  // The call site knows the layout, the upload knows the art, and the art is
  // the thing that changes without a deploy.
  const base: Record<string, unknown> = {
    ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio } : { height: opts.height ?? 148 }),
    ...(opts.width ? { width: opts.width, alignSelf: "center" } : {}),
    borderRadius: opts.radius ?? 20,
    backgroundColor: "#0b0b0f",
  };
  /**
   * THE BOX, when the media sits behind a whole screen.
   *
   * "window" is the original: pin all four edges and let `cover` resolve the
   * mismatch between the art's shape and the screen's by cutting. That is the
   * right trade for a texture and the wrong one for art whose full width IS
   * the subject — no phone is 9:16 any more, so a 9:16 keyboard loses its
   * outer column of keys on every device, and no focal point can save it
   * because the thing that has to survive is the whole width.
   *
   * "width" gives the box the SCREEN'S width and the ART'S aspect. The two
   * agree by construction, so there is nothing left to crop, and the leftover
   * is the screen's own ground — invisible exactly when the art is grounded in
   * the same colour, which is the case this exists for. `pin` then decides
   * which edge it is held against, because art composed against its own bottom
   * edge has to meet the screen's.
   *
   * Needs the art's aspect. Without one there is no box to derive, so it falls
   * back to "window" rather than guessing.
   */
  const fillMode = entry.present?.fill ?? opts.fill ?? "window";
  const artAspect = Number(entry.present?.aspect ?? 0);
  const pin = entry.present?.pin ?? opts.pin ?? "bottom";
  // Guarded so no padding yields 0 and not -0. They mean the same to the
  // layout and different to anything comparing them.
  const bleedTop = opts.fullBleedTop ? -opts.fullBleedTop : 0;
  const bleedX = opts.fullBleed ? -opts.fullBleed : 0;
  // Only meaningful behind a whole screen. In the column, the box already has
  // a shape the call site chose, and there is no window to leave over.
  const fitsAxis =
    opts.behind === true && artAspect > 0 && (fillMode === "width" || fillMode === "height");
  /**
   * ZOOM. 1 means the art reaches the edges of its axis; less pulls it back,
   * keeping the shape and the pinned edge.
   *
   * As a percentage rather than points, because the inset has to stay the same
   * fraction of every screen — a fixed number of points is a wide margin on a
   * mini and a narrow one on a Pro Max, which is the same mistake as a fixed
   * box under `cover`.
   */
  const zoom = Math.min(1, Math.max(0.05, Number(entry.present?.scale ?? 1)));
  const inset = `${Math.round(((1 - zoom) / 2) * 1e4) / 1e2}%`;
  const axisBox: Record<string, unknown> = !fitsAxis
    ? {}
    : fillMode === "width"
      ? {
          // The bleed cancels the parent's padding at full size; below it the
          // art is deliberately inset, so a percentage replaces both.
          ...(zoom < 1 ? { left: inset, right: inset } : { left: bleedX, right: bleedX }),
          aspectRatio: artAspect,
          // ONE EDGE ONLY. Naming both would give Yoga a height as well as a
          // shape, and then the shape — which is the whole point — is the
          // constraint it drops. So there is no "center" on this axis: a box
          // with a fixed aspect cannot be centred by edges alone, and "bottom"
          // is what art grounded in its own frame actually wants.
          ...(pin === "top" ? { top: bleedTop } : { bottom: 0 }),
        }
      : {
          top: bleedTop, bottom: 0, aspectRatio: artAspect,
          // No left/right, so alignSelf is free to centre it on the cross axis.
          alignSelf: pin === "top" ? "flex-start" : pin === "bottom" ? "flex-end" : "center",
        };

  const shown = opts.behind
    ? {
        style: {
          position: "absolute" as const,
          // NEGATIVE, by the parent's own padding.
          //
          // Yoga lays an absolute child out against its parent's PADDING box,
          // not its border box — so `top: 0` on a screen with 72pt of top
          // padding starts 72pt down, and a backdrop meant to fill the window
          // came out as an inset rectangle with the screen's black showing
          // around it. Backdrop and background were the same colour, so it did
          // not look inset; it looked absent.
          //
          // The call site knows the padding because the call site wrote it.
          // All four edges fill the window. When the box is being given the
          // ART'S shape instead, `axisBox` supplies three edges and a ratio —
          // and it has to REPLACE these rather than be merged over them, since
          // a fourth edge would give Yoga a height and the ratio would be the
          // constraint it dropped.
          ...(fitsAxis
            ? axisBox
            : { top: bleedTop, left: bleedX, right: bleedX, bottom: 0 }),
          backgroundColor: entry.present?.background ?? "#000000",
          overflow: "hidden" as const,
        },
        fit: entry.present?.fit ?? opts.fit ?? "cover",
      }
    : heroStyle(
        entry,
        base,
        { x: opts.fullBleed ?? 0, top: opts.fullBleedTop ?? 12 },
        opts.fullBleed ? "full" : "card",
      );
  // "contain" whenever the box was cut to the art's own shape. The two are
  // identical when the ratios agree exactly, and they do not always agree
  // exactly — a declared aspect is rounded, a decoded frame is not — so this
  // is the difference between a hairline of ground and a hairline cropped off
  // the very thing the mode exists to protect.
  const fit = fitsAxis ? "contain" : (entry.present?.fit ?? opts.fit ?? "cover");
  /**
   * ARRIVE ON A STILL, THEN MOVE.
   *
   * Held out of this file for a while, and the reason is worth keeping: a
   * paused expo-video player that has never played renders NOTHING. There is
   * no poster frame, so a clip told to wait a second and a half showed a second
   * and a half of black — indistinguishable from a missing file, which is
   * exactly how it was reported.
   *
   * The client now primes the surface: on the first pause it plays, stops on
   * the next tick and rewinds, so one frame is decoded and held. That makes
   * `playing: false` mean "showing the still" instead of "showing nothing",
   * which is what this always assumed and never got.
   *
   * Still off by default, and still nothing native — the wait is a delay and a
   * setState on the clip's own onAppear, running independently of whatever the
   * screen is doing, which must not be held up by it.
   */
  const startDelay = Math.max(0, Number(entry.present?.startDelayMs ?? 0));
  /**
   * Looping is the right default for a hero, which is ambient and has no end.
   * It is the WRONG one for a demo: a clip that loops has no last frame to
   * come to rest on, so "hold the final state" is not a thing it can do. The
   * call site knows which kind it is; the upload can still overrule.
   */
  const loops = entry.present?.loop ?? opts.loop ?? true;
  /**
   * Placement facts, forwarded untouched. The client measures the box it is
   * really drawing into and works out the offset there — which is the whole
   * point: a stored offset is right on one aspect ratio and wrong on the next,
   * and the opening film is authored at exactly one device's shape.
   */
  const place = {
    ...(entry.present?.aspect ? { aspect: entry.present.aspect } : {}),
    ...(entry.present?.focusX !== undefined ? { focusX: entry.present.focusX } : {}),
    ...(entry.present?.focusY !== undefined ? { focusY: entry.present.focusY } : {}),
    ...(entry.present?.anchorX !== undefined ? { anchorX: entry.present.anchorX } : {}),
    ...(entry.present?.anchorY !== undefined ? { anchorY: entry.present.anchorY } : {}),
  };
  const inner: Node = isVideo
    ? {
        type: "Video",
        props: {
          source: mediaSrc(key),
          // A hero is ambient: it plays itself, in silence. Muted is not
          // politeness — an unmuted autoplay is blocked outright.
          autoplay: !startDelay, loop: loops, muted: true, contentFit: fit, ...place,
          ...(startDelay ? { playing: false } : {}),
        },
        ...(startDelay ? { bind: { playing: HERO_PLAY_KEY } } : {}),
        ...(startDelay ? {
          on: { onAppear: { kind: "sequence", actions: [
            { kind: "delay", ms: startDelay },
            { kind: "setState", path: HERO_PLAY_KEY, value: true },
          ] } },
        } : {}),
        style: FILL_STYLE,
        // A bundle without Video draws nothing at all; the still frame is a
        // worse hero than the video and a far better one than a hole.
        fallback: {
          type: "Image",
          props: { source: mediaSrc(key), contentFit: fit },
          style: FILL_STYLE,
        },
      }
    : {
        type: "Image",
        props: { source: mediaSrc(key), contentFit: fit },
        style: FILL_STYLE,
      };
  return [
    {
      type: "Stack",
      // The VIEW clips; the media fills it. Rounded corners set on the media
      // itself have nothing to cut — see the intro plate.
      ...(opts.onlyOn ? { visibleIf: { platform: opts.onlyOn } } : {}),
      style: opts.behind
        ? shown.style
        : {
            ...shown.style,
            overflow: "hidden",
            marginBottom: opts.marginBottom ?? (opts.fullBleed ? 26 : 18),
          },
      children: [inner],
    } as Node,
  ];
}

/**
 * Post-splash intro — a pure SDUI screen. ONE piece of media (the `intro`
 * key), played inside the same circular white plate the in-app mic wears, on
 * black. Same shape, same size: the first thing a user sees is the thing
 * they will be tapping every day.
 *
 * The same `intro` key already gates whether the intro plays at all
 * (flags["intro.media"] in the bootstrap), so uploading one file both turns
 * the intro on and supplies it.
 *
 * Slideshow with a single frame is the player: its timer is what fires
 * onComplete, since neither a GIF nor a video reports its own length back to
 * the screen tree. That makes INTRO_PLAY_MS the intro's duration — set it to
 * roughly the length of the file you upload.
 *
 * To customize:
 *   - Swap the media:  POST /v1/media/upload?key=intro
 *   - Change duration: INTRO_PLAY_MS
 *   - Change size:     INTRO_PLATE (the plate) / INTRO_INSET (the media)
 *   - Change what comes after: the `done` action's screenId
 */
/** The onboarding hero's particle field. Larger than the mic — it is the
 *  screen's centrepiece, not a control. */
export const HERO_PARTICLE = 208;

/**
 * Explicit hero overrides, as raw SDUI nodes, keyed by slot id.
 *
 * The last word on what a hero is. Set an entry here — or via the HERO_<SLOT>
 * env vars below — and that node renders instead of anything else: a video, a
 * Lottie, a stack of text, a chart, whatever the renderer knows how to draw.
 * Nothing about the surrounding screen has to change.
 *
 * Empty by default, because the built-ins are the intended look.
 */
const HERO_OVERRIDES: Record<string, Node | undefined> = {
  onboarding: parseNodeEnv("HERO_ONBOARDING"),
  paywall: parseNodeEnv("HERO_PAYWALL"),
};

/** A hero node handed in as JSON on an env var, so a hero can be swapped
 *  without a code change. Malformed JSON is ignored rather than crashing boot —
 *  a bad paste must not take the app's first screen down with it. */
function parseNodeEnv(name: string): Node | undefined {
  const raw = process.env[name];
  if (!raw?.trim()) return undefined;
  try {
    const node = JSON.parse(raw) as Node;
    if (node && typeof node === "object" && typeof node.type === "string") return node;
    console.warn(`[hero] ${name} is not an SDUI node ({ type: ... }) — ignoring.`);
  } catch (err) {
    console.warn(`[hero] ${name} is not valid JSON — ignoring.`, (err as Error).message);
  }
  return undefined;
}

/**
 * Resolve one hero slot. Three sources, highest first:
 *
 *   1. an explicit override node   (HERO_OVERRIDES / HERO_<SLOT> env)
 *   2. uploaded media              (POST /v1/media/upload?key=<mediaKeys[n]>)
 *   3. the built-in animation
 *
 * The point is that every hero on every screen answers to the same three
 * questions in the same order, so replacing one is an upload or an env var
 * rather than an edit somewhere inside a screen tree.
 */
/**
 * Apply a slot's stored presentation to a hero box.
 *
 * The registry knows how the art wants to be shown; it cannot know what it is
 * being shown inside. `bleed` supplies that one missing number — the parent
 * screen's own padding — which is the only way a child reaches the screen's
 * edge. Everything else comes off the entry, so a slot goes from a rounded
 * card to edge-to-edge with a POST and no deploy.
 */
function heroStyle(
  entry: MediaEntry | undefined,
  base: Record<string, unknown>,
  bleed: { x: number; top: number },
  defaultShape: "full" | "card" = "card",
): { style: Record<string, unknown>; fit: "cover" | "contain" } {
  const pr: MediaPresent = entry?.present ?? {};
  const shape = pr.shape === "plate" ? "card" : (pr.shape ?? defaultShape);
  const style: Record<string, unknown> = { ...base };
  if (pr.aspectRatio) { style.aspectRatio = pr.aspectRatio; delete style.height; }
  // A size of its own, in points, centred: a 300pt card where the built-in
  // was a 208pt circle. Height follows the ratio unless given.
  if (pr.boxWidth) { style.width = pr.boxWidth; style.alignSelf = "center"; if (!pr.aspectRatio && !pr.boxHeight) style.aspectRatio = 1; }
  if (pr.boxHeight) { style.height = pr.boxHeight; delete style.aspectRatio; }
  if (pr.radius !== undefined) style.borderRadius = pr.radius;
  if (pr.background) style.backgroundColor = pr.background;
  if (shape === "full") {
    // Negative side margins cancel the parent's padding — the only way a
    // child reaches the edge of a padded screen.
    style.marginLeft = -bleed.x;
    style.marginRight = -bleed.x;
    style.marginTop = -bleed.top;
    style.width = undefined;
    style.alignSelf = "stretch";
    // A corner on a full-bleed image is a gap at the screen's edge, so it
    // takes an explicit radius to keep one.
    if (pr.radius === undefined) style.borderRadius = 0;
  } else if (pr.inset !== undefined) {
    style.marginLeft = pr.inset;
    style.marginRight = pr.inset;
  }
  return { style, fit: pr.fit ?? "cover" };
}

export function heroSlot(opts: {
  id: string;
  mediaKeys: string[];
  style: Record<string, unknown>;
  builtIn: Node;
  frameMs?: number;
  /** The parent screen's own padding, so a "full" presentation can cancel it. */
  bleed?: { x: number; top: number };
  /** What this slot looks like when the entry says nothing. */
  defaultShape?: "full" | "card";
  /** A window prefers "<key>.desktop" (mediaKeyFor). */
  formFactor?: string;
  /**
   * Hand a clip over by its registry key, not its url. For the screen a first
   * launch's splash also waits on (the one after the opening): the splash
   * holds until every url on it is prefetched, and a prefetch cannot warm a
   * clip for the video player, so a url there only held the splash for
   * nothing. The splash waits on the opening film's own first frame instead
   * (the app's media/firstFrame). The app publishes the registry before any
   * screen draws, so a key resolves as surely as a url. Phones only: the
   * desktop renderer reads urls.
   */
  videoByKey?: boolean;
}): Node {
  const override = HERO_OVERRIDES[opts.id];
  if (override) return { ...override, style: { ...opts.style, ...(override.style ?? {}) } };

  const reg = getMediaRegistryFn?.() ?? {};
  const live = opts.mediaKeys.map((k) => mediaKeyFor(k, opts.formFactor)).filter((k) => reg[k]?.url);
  // Resolved to urls server-side — no client registry lookup, no race with
  // the bootstrap (the failure that kept the intro black).
  const frames = live.map((k) => mediaSrc(k));
  // The FIRST live key owns the presentation. A multi-frame sequence is one
  // picture playing in one box, so it gets one answer, not one per frame.
  const bleed = opts.bleed ?? { x: 0, top: 0 };
  const { style: shown, fit } = heroStyle(reg[live[0]], opts.style, bleed, opts.defaultShape);

  if (frames.length >= 2) {
    return {
      type: "Slideshow",
      style: { ...shown, overflow: "hidden" },
      props: { frames, frameMs: opts.frameMs ?? 2200, loops: 0, contentFit: fit },
    };
  }
  if (frames.length === 1) {
    const entry = reg[live[0]];
    // An mp4 needs a Video node; Image renders nothing for one. This slot only
    // ever built an Image, so a clip uploaded here was an invisible hole —
    // the same failure that kept the intro black, in a second place.
    const isVideo =
      (entry?.contentType ?? "").toLowerCase().startsWith("video/") ||
      /\.(mp4|mov|m4v|webm)(\?|$)/i.test(entry?.url ?? "");
    const fill = FILL_STYLE;
    const clip = isVideo && opts.videoByKey && opts.formFactor !== "desktop"
      ? { key: live[0] } : frames[0];
    const inner: Node = isVideo
      ? {
          type: "Video",
          style: fill,
          // A hero is ambient: it plays itself, forever, in silence. Muted is
          // not politeness — an unmuted autoplay is blocked outright.
          props: { source: clip, autoplay: true, loop: true, muted: true, contentFit: fit },
          // A bundle without Video draws nothing at all; a still frame is a
          // worse hero than the clip and a far better one than a hole.
          fallback: {
            type: "Image",
            style: fill,
            props: { source: clip, contentFit: fit },
          },
        } as Node
      : {
          type: "Image",
          style: fill,
          props: { source: frames[0], contentFit: fit },
        } as Node;
    // The VIEW clips, the media fills it. `overflow: hidden` cuts a view's
    // children; on an image element the pixels are the element itself, so
    // rounded corners applied straight to the image have nothing to cut —
    // the intro plate drew square for exactly this reason.
    return {
      type: "Stack",
      style: { ...shown, overflow: "hidden" },
      children: [inner],
    };
  }
  return { ...opts.builtIn, style: { ...shown, ...(opts.builtIn.style ?? {}) } };
}
