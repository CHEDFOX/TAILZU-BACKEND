/**
 * Experience service — the screen catalog.
 *
 * This is where the backend "owns the UI". Each screen is built as data (a tree
 * of SDUI Nodes) and handed to the generic renderer in the app. Change these
 * builders → the app changes, with no client rebuild.
 *
 * See ../../../shared/types/sdui.ts for the contract.
 */
import type {
  ActionRef,
  ActionSpec,
  BootstrapResponse,
  KeyboardActionSpec,
  KeyboardConfigResponse,
  KeyboardNode,
  LaunchCard,
  MediaPresent,
  NavigationShell,
  TabGlyph,
  Node,
  ScreenResponse,
  ThemeTokens,
  TypeRole,
} from "../../../shared/types/sdui.js";
import { SDUI_SCHEMA_VERSION } from "../../../shared/types/sdui.js";
import { applyRollouts, activeRollouts } from "./rollout.js";
import type { HistoryEntry, PaywallConfig, PaywallPlan, Personality, StatsResponse, UsageSummary } from "../../../shared/types/api.js";
import { getConfig } from "../config.js";
import type { Allowance } from "../usage/allowance.js";
import {
  PERSONALITY_PRESETS,
  findPreset,
  TONE_LABELS,
  MAX_PINNED_PRESETS,
  applyPresetOverrides,
} from "./personalityPresets.js";

/**
 * Optional accessor into the media registry — set at boot by server.ts so the
 * catalog can surface uploaded media URLs into the keyboard config without a
 * circular import. Signature matches routes/media.ts getMediaRegistry().
 */
type MediaEntry = {
  url: string; contentType: string; size: number; uploadedAt: number;
  /** Playback length, when the compressor has measured it. */
  durationMs?: number;
  /** How this slot is shown — shape, fit, radius, hold. Set over HTTP by
   *  POST /v1/media/present, so changing it needs no deploy. */
  present?: MediaPresent;
};
let getMediaRegistryFn: (() => Record<string, MediaEntry>) | null = null;
export function setMediaRegistryAccessor(fn: () => Record<string, MediaEntry>): void {
  getMediaRegistryFn = fn;
}

/**
 * Media source for a registry key, RESOLVED server-side.
 *
 * `{ url, contentType }` instead of `{ key }`: the client resolves it with no
 * registry lookup at all, which removes the whole class of "the registry
 * wasn't set yet when this screen rendered" failures — the race that kept the
 * intro black. The key form survives as the fallback so a screen built while
 * the registry is somehow empty still degrades to the old behaviour rather
 * than to nothing.
 */
function mediaSrc(key: string): Record<string, unknown> {
  const entry = getMediaRegistryFn?.()?.[key];
  return entry?.url ? mediaSource(entry.url, entry.contentType) : { key };
}

/**
 * A media source shaped to survive the SHIPPED Video node.
 *
 * That node does this before handing the source to the player:
 *
 *   spec = "source" in raw ? raw : { source: raw }
 *
 * and the resolver behind it understands { url }, { key }, { asset }, { data },
 * { emoji } and a bare string — never { source }. So a plain { url } was boxed
 * into a shape nothing could read, resolved to "empty", and the player returned
 * null. Every backend Video rendered nothing, silently. That is the black
 * intro and the flow clip that was "just the text".
 *
 * The fix is one line in the app, and it is written and pushed. This is what
 * reaches the builds already installed, which cannot be fixed at all otherwise:
 *
 *   `source` present  → the node takes the pass-through branch and stops
 *                       wrapping, so the object arrives at the resolver intact.
 *   `url` present     → the resolver matches on it, first, and never looks at
 *                       `source`.
 *
 * Forward-safe, deliberately. The fixed node reads `raw.source`, which is the
 * url string, and the resolver's string branch turns that back into { url };
 * the extension then names the type where contentType would have. So both the
 * broken build and the fixed one play the same clip from the same payload, and
 * nothing has to be timed against an OTA.
 *
 * REMOVE IT when no install predating that fix is still in the field, and not
 * before — a shim whose reason has been forgotten is worse than the bug.
 */
function mediaSource(url: string, contentType?: string): Record<string, unknown> {
  return { url, ...(contentType ? { contentType } : {}), source: url };
}

/**
 * Optional hero art for a screen — the ONE uniform media slot every major
 * screen carries.
 *
 * Upload to `hero.<screenId>` and the screen opens with that art in a rounded
 * banner; upload nothing and the node does not exist, so an undressed screen
 * looks deliberate instead of reserving an empty hole. The check happens HERE,
 * server-side, which is what makes absence free.
 *
 *   POST /v1/media/upload?key=hero.voices      → tones list gets a header
 *   POST /v1/media/upload?key=hero.stats       → stats screen gets one
 *   DELETE the key → the banner is gone next fetch
 *
 * A GIF animates (expo-image plays it natively); a still just sits. Same
 * resilient pattern as the intro: plain Image node, resolved url, clipped by a
 * plain view.
 */
/**
 * How a media node is told to fill the box its parent already drew.
 *
 * NOT `{ width: "100%", height: "100%" }`, which is what every one of these
 * used to be and what quietly broke every full-bleed image in the app. The
 * client's Image node applies its own defaults UNDERNEATH whatever style
 * arrives — `aspectRatio: 1.6` and `borderRadius: 10` — and a style that sets
 * only width and height overrides neither. Yoga then holds a width and an
 * aspect ratio, which is enough to derive a height, so the height was ignored
 * and the media rendered as a rounded 1.6 landscape strip: the opening media,
 * the flow clip, every hero, all cropped through their own middle.
 *
 * Four insets leave Yoga nothing to derive — both dimensions come from the
 * parent, so the aspect ratio has no job — and the explicit radius buries the
 * other default. It is the one shape that survives a client this file cannot
 * rebuild.
 */
const FILL_STYLE = {
  position: "absolute" as const,
  top: 0, left: 0, right: 0, bottom: 0,
  borderRadius: 0,
};

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

/**
 * THE WAY INTO SETTINGS, ON EVERY TAB ROOT.
 *
 * Settings has never been a tab. The app draws a gear in the header of
 * whichever root is showing and pushes the screen from there — so when all
 * three roots went full bleed and hid that header, the gear went with it and
 * the Settings screen became a screen nothing could reach.
 *
 * Drawn by the screens rather than by restoring the header, because the
 * full-bleed roots are the design and a bar above them is not. One helper, so
 * it sits in the same place on all three and cannot drift: a control that
 * moves between tabs has to be found again on each one.
 *
 * The colour is the caller's, because the ground is not the same on all three
 * — white on the Train art and the You backdrop, ink on the Stats amber. A
 * light glyph on amber is the kind of thing that survives review and then
 * cannot be seen on a phone.
 */
const GEAR = {
  size: 34,
  inset: 16,
  top: 58,
  glyph: 15,
  stroke: 2.1,
  onDark: "rgba(255,255,255,0.66)",
  onDarkBackground: "rgba(255,255,255,0.10)",
  onLight: "rgba(11,11,13,0.62)",
  onLightBackground: "rgba(11,11,13,0.08)",
};

function settingsGear(on: "dark" | "light" = "dark"): Node {
  const color = on === "light" ? GEAR.onLight : GEAR.onDark;
  const background = on === "light" ? GEAR.onLightBackground : GEAR.onDarkBackground;
  return {
    type: "Stack",
    on: { onPress: { kind: "sequence", actions: [
      { kind: "haptic", style: "selection" },
      { kind: "navigate", screenId: "settings" },
    ] } },
    props: { pressOpacity: 0.6 },
    style: {
      position: "absolute", top: GEAR.top, right: GEAR.inset,
      width: GEAR.size, height: GEAR.size, borderRadius: GEAR.size / 2,
      alignItems: "center", justifyContent: "center",
      backgroundColor: background,
    },
    children: [{
      type: "SVG",
      // Three right-aligned lines, shortest at the top — the same mark the
      // header drew, at the same weight, so nothing has to be relearnt.
      props: {
        viewBox: "0 0 24 24",
        d: "M12 7 H21 M7.5 12 H21 M3 17 H21",
        fill: "none", stroke: color, strokeWidth: GEAR.stroke,
        strokeLinecap: "round",
      },
      style: { width: GEAR.glyph, height: GEAR.glyph },
    }],
  };
}

function screenHero(
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
  } = {},
): Node[] {
  const key = `hero.${screenId}`;
  const entry = getMediaRegistryFn?.()?.[key];
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

// --- Global theme -----------------------------------------------------------

// Ladder pairs: 13/21 captions, 15 body, 21 lg, 26/34 h1, 34 brand display.
const TYPE_SIZES = { overline: 11, caption: 13, label: 13, body: 15, lg: 21, h1: 26, brand: 34 };

/**
 * The type scale. Every run of text the app sets on its own is one of these:
 * a Text variant, a content block, a button label, a settings row, the title
 * bar, the error and update cards, the native onboarding screens. The
 * renderer reads a role by name and adds nothing — no size, weight, leading,
 * tracking or margin is decided on the device.
 *
 * `family` is a slot: "display" is filled by THEME.font.display, "body" by
 * THEME.font.family. Values mirror what the renderer shipped with, so this
 * moves ownership, not the look. Change a number here and the app follows on
 * the next cache bump.
 */
const S = TYPE_SIZES;

/**
 * The You tab's greeting, whole — every value it has, in one place.
 *
 * It sits up here rather than beside the rest of the You tab because its two
 * lines are part of the type scale, and the scale is built below. Splitting it
 * would have put the sizes in one section, the colours in another and the
 * position in a third, and a three-line greeting is not worth reading three
 * places to change.
 *
 * NOTHING HERE IS SHARED. The sizes start on the golden ladder (13 and 26 are
 * its label and h1 rungs) but they are the greeting's own numbers now, not
 * references to them — so moving the ladder does not move the greeting, and
 * balancing the greeting does not move the app. Same for the two colours.
 * Every value can be set alone, which is what makes the pair adjustable
 * against each other: a name that reads, and a hello that stays behind it.
 */
const GREET = {
  /** Where the block sits. Top left, on the settings gear's line. */
  top: 56,
  left: 18,
  /** Air between the hello and the name. */
  gap: 2,
  /**
   * How much width the name may take before it is cut short.
   *
   * The gear is 34pt at 16pt from the right edge, so the name has the screen
   * less about 66pt before the two meet. A long name is trimmed with an
   * ellipsis rather than wrapped: a second line would push the greeting into
   * the deck, and the deck is the thing this screen is for.
   */
  nameMaxWidth: 240,
  nameLines: 1,
  /** How long a hello is held before it turns over. */
  intervalMs: 2600,
  /** The turn itself. Half out, half in. */
  flipMs: 620,
  /**
   * HOW ONE WORD BECOMES THE NEXT — and it is a performance decision here as
   * much as a visual one.
   *
   * "turn" is the 3D flip and it is the better effect. It is also expensive:
   * a rotateX with a perspective makes its parent composite in 3D, and on
   * Android every blurred view beneath re-renders when that happens. This tab
   * carries five of them — a full-screen backdrop and one per card — so the
   * turn showed up as the whole screen flickering on every word: the name,
   * the settings icon, the note under the deck, none of them near the
   * greeting.
   *
   * "fade" is a crossfade. Opacity alone, no transform, no offscreen pass,
   * nothing else disturbed. A caption quietly changing language does not need
   * the more expensive gesture.
   */
  flip: "fade" as "fade" | "turn",
  /** The small tracked line. A label, not a sentence. */
  hello: {
    size: 13,
    weight: "300",
    tracking: 1.6,
    color: "rgba(255,255,255,0.42)",
    /**
     * A FIXED BOX FOR THE WORD, and this is the whole reason it is here.
     *
     * The words are not one script. "Hello" is Latin and sits inside the
     * ascender and descender of its own face; नमस्ते hangs a headline above the
     * letters and drops matras below them; Thai stacks tone marks a second
     * storey up. Each measures a different height, so a line left to size
     * itself grew and shrank as the greeting turned over — and the name, which
     * is laid out under it, stepped down and back up with every word. The one
     * still thing on the screen was moving, and it was moving because of a
     * decoration above it.
     *
     * So the line is given a height once and never asked again. It is set from
     * the tallest script rather than from "Hello", which means a little air
     * under the Latin word and no movement anywhere.
     */
    lineHeight: 22,
  },
  /** The one proper noun on the screen, so it gets the display face. */
  name: {
    family: "display" as const,
    size: 26,
    weight: "300",
    tracking: 0.2,
    color: "rgba(255,255,255,0.96)",
  },
};

export const TYPE_ROLES: Record<string, TypeRole> = {
  // Text variants — `{ type: "Text", props: { variant } }`.
  brand:    { family: "display", size: S.brand, lineHeight: 38, letterSpacing: 0.2, color: "text" },
  h1:       { family: "display", size: S.h1, lineHeight: 34, letterSpacing: 0.3, color: "text" },
  overline: { size: S.overline, weight: "500", letterSpacing: 3, transform: "uppercase", color: "label", marginBottom: 10 },
  quote:    { family: "display", size: S.lg, lineHeight: 28, italic: true, color: "muted" },
  label:    { size: S.label, letterSpacing: 1, color: "label", marginBottom: 8 },
  muted:    { size: S.body, lineHeight: 22, color: "muted" },
  caption:  { size: S.caption, color: "muted" },
  body:     { size: S.body, lineHeight: 26, weight: "300", color: "body" },

  // Content blocks — the same voices with their rhythm attached.
  heading:    { family: "display", size: S.h1, lineHeight: 34, letterSpacing: 0.3, color: "text", marginBottom: 24 },
  paragraph:  { size: S.body, lineHeight: 26, weight: "300", color: "body", marginBottom: 18 },
  quoteBlock: { family: "display", size: S.lg, lineHeight: 28, italic: true, color: "muted", align: "center", marginVertical: 16 },
  badge:      { size: S.overline, weight: "500", letterSpacing: 2.5, transform: "uppercase" },

  // Controls and lists.
  button:          { size: 16, weight: "700", letterSpacing: 0.4 },
  buttonSecondary: { size: 16, weight: "600", letterSpacing: 0.4 },
  chip:            { size: 14 },
  chipSelected:    { size: 14, weight: "700" },
  mic:             { size: S.body, weight: "700" },
  row:             { size: 16, color: "text" },
  rowValue:        { size: S.body, color: "muted" },
  rowChevron:      { size: 20, color: "muted" },
  keyValueLabel:   { size: S.body, color: "muted" },
  keyValueValue:   { size: S.body, weight: "600", color: "text" },
  heroTitle:       { size: S.h1, weight: "800", color: "text" },
  heroSubtitle:    { size: S.body, color: "muted", marginTop: 4 },
  icon:            { size: 20, color: "text" },

  // Greeting grid — the big hello and the language pills under it.
  greeting:     { family: "display", size: 46, weight: "300", letterSpacing: 0.2, align: "center", marginBottom: 40 },
  greetingPill: { size: S.body, weight: "300", letterSpacing: 0.5 },

  // Charts. The ring's one big number, the word under it, and the legend
  // rows beside it. Small and quiet: a chart that shouts is a chart you read
  // instead of the thing it is about.
  chartValue:       { size: 24, weight: "700", color: "text" },
  chartCenterLabel: { size: 9, letterSpacing: 0.8, color: "label" },
  chartLegend:      { size: 11.5, color: "body" },
  chartLegendValue: { size: 11.5, weight: "600", color: "text" },

  // The You tab's greeting. Both lines come off GREET above — the one place
  // that owns this block — so the roles here are a view of it, never a second
  // set of numbers to keep in step.
  greetHello: {
    size: GREET.hello.size,
    lineHeight: GREET.hello.lineHeight,
    weight: GREET.hello.weight,
    letterSpacing: GREET.hello.tracking,
    color: "greetHello",
  },
  greetName: {
    family: GREET.name.family,
    size: GREET.name.size,
    weight: GREET.name.weight,
    letterSpacing: GREET.name.tracking,
    color: "greetName",
  },

  // The shell: title bar, error card, refresh banner, update gate, toast.
  title:        { size: 22, weight: "800", color: "text" },
  headerIcon:   { size: 24, weight: "700", color: "text" },
  toast:        { size: 14 },
  errorTitle:   { size: 18, weight: "700", color: "text", marginBottom: 8 },
  errorBody:    { size: 14, color: "muted", align: "center", marginBottom: 20 },
  errorAction:  { size: 14, weight: "700" },
  banner:       { size: 14, weight: "600" },
  updateTitle:  { size: 22, weight: "800", color: "text", align: "center", marginBottom: 10 },
  updateBody:   { size: S.body, lineHeight: 22, color: "muted", align: "center", marginBottom: 22 },
  updateAction: { size: S.body, weight: "700" },
  updateLater:  { size: 14, color: "muted" },

  // The sign-in screen's own chrome. The brand and tagline sizes live in
  // AUTH_UI (that screen's contract); these are the rest of its type.
  authField:    { size: S.body, weight: "300", letterSpacing: 0.3 },
  authPrompt:   { size: S.body, weight: "300", letterSpacing: 0.3 },
  authCode:     { size: 17, weight: "300" },
  authNote:     { size: 12, align: "center" },
  authSearch:   { size: S.body },
  authPickName: { size: S.body, weight: "300" },
  authPickDial: { size: 14 },

  // Native onboarding — the language picker and the name card draw before
  // any screen JSON exists, but after bootstrap, so they read the scale too.
  langGreeting:  { size: 52, weight: "300", align: "center" },
  langPill:      { size: S.body, weight: "300", letterSpacing: 0.5 },
  profileHello:  { family: "display", size: 32, weight: "700", marginBottom: 18 },
  profileName:   { size: 22, weight: "300", align: "center" },
  profileLabel:  { size: 12 },
  profileAction: { size: 16, weight: "700" },
};

export const THEME: ThemeTokens = {
  color: {
    bg: "#000000",
    surface: "#000000",
    card: "#0b0b0f",
    inputBg: "#0e0e12",
    border: "rgba(255,255,255,0.10)",
    // WHITE primary — matches the original Plutto-style design (black
    // surface with white primary CTAs). The brand accent (used for key
    // press flashes, refined-text word highlight, mic recording state)
    // is the warm amber sampled from mic.animation — not a punchy
    // pure orange. See ACCENT_AMBER.
    primary: "#FFFFFF",
    text: "rgba(255,255,255,0.96)",
    body: "rgba(255,255,255,0.74)",
    muted: "rgba(255,255,255,0.55)",
    label: "rgba(255,255,255,0.42)",
    danger: "#e0556b",
    success: "#4caf50",
    // The You tab's greeting, one token per line, both owned by GREET. Kept
    // apart from `label` and `text` on purpose: those two carry most of the
    // app's type, so the pair could not be balanced against each other
    // without dragging every caption and heading along.
    greetHello: GREET.hello.color,
    greetName: GREET.name.color,
  },
  // GOLDEN SCALE (φ via the Fibonacci ladder 5·8·13·21·34·55): every spacing
  // step and type size in the app comes off this ladder, so screens compose
  // on one ratio instead of ad-hoc values.
  space: { xs: 5, sm: 8, md: 13, lg: 21, xl: 34, content: 21, contentTop: 34 },
  radius: { sm: 8, md: 13, card: 18, pill: 999 },
  font: {
    sizes: TYPE_SIZES,
    weights: { light: "300", regular: "400", medium: "500", bold: "700", heavy: "800" },
    // The two faces. Any name in FONTS below, or one the OS already has.
    // Unset: body is the system font, display is the platform serif.
    // family: "Tailzu Sans",
    // display: "Tailzu Display",
    roles: TYPE_ROLES,
  },
};

/**
 * Typefaces the app downloads and registers at boot.
 *
 * The app bundles no fonts and until now could only name what the OS already
 * had, so changing the product's typeface meant adding a file to the repo and
 * shipping a build — the one design change that should never need one.
 *
 * Add an entry and every screen can use it: THEME.font.family for the running
 * text, THEME.font.display for headings, or style.fontFamily on one node.
 *
 *   "Tailzu Display": "https://api.tailzu.space/media/display.ttf"
 *
 * Serve the file from the media registry (upload it like any other asset) or
 * any https host. The client refuses anything that is not https and does not
 * end in .ttf/.otf/.woff/.woff2, loads them in the background, and falls back
 * to the system font for any that fail — a dead URL costs a fallback, never a
 * blank screen.
 */
export const FONTS: Record<string, string> = {};

/**
 * Flow Session idle window (ms) — how long the app keeps the background mic
 * warm after the last dictation. ONE constant serves every surface (bootstrap
 * flags, keyboard config, flow_arm screen's armFlowSession action): the same
 * key used to ship 10 min in bootstrap but 5 min in the keyboard config, so
 * app and keyboard disagreed on session lifetime.
 */
const FLOW_IDLE_TIMEOUT_MS = 600_000;

/**
 * Transport for a Flow dictation: "stream" (socket, live) or "oneshot"
 * (buffer + one POST at stop). Env-overridable so the switch can be thrown
 * without a deploy; see kb.flow.transport for the trade-off.
 */
/** App Store numeric id, assigned by App Store Connect. Digits only; anything
 *  else is treated as unset so a half-filled value cannot ship a broken link. */
const APP_STORE_ID_DEFAULT = "6784811357"; // eas.json → submit.production.ios.ascAppId
const APP_STORE_ID = /^\d{6,}$/.test(process.env.APP_STORE_ID ?? "")
  ? (process.env.APP_STORE_ID as string)
  : APP_STORE_ID_DEFAULT;

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

const FLOW_TRANSPORT = process.env.FLOW_TRANSPORT === "oneshot" ? "oneshot" : "stream";

/**
 * Whether the sign-in gate offers SMS. Env-gated so it can be turned on the
 * moment Twilio is verified in Supabase, without a deploy — and turned off just
 * as fast if SMS delivery goes bad in a region.
 */
const AUTH_ENABLE_PHONE = process.env.AUTH_ENABLE_PHONE !== "false";

/**
 * When the intro plays: "firstRun" (default), "everyLaunch", or "never".
 *
 * firstRun means "until they finish onboarding" — the cinematic belongs to
 * meeting the product, and a returning user opening the app to write something
 * does not want to sit through it.
 */
const INTRO_PLAY_WHEN =
  process.env.INTRO_PLAY_WHEN === "everyLaunch" ? "everyLaunch"
  : process.env.INTRO_PLAY_WHEN === "never" ? "never"
  : "firstRun";

/**
 * Free words per month — THE SAME NUMBER THE SERVER ENFORCES.
 *
 * This claimed to be that already, and was not. It re-read the env with its own
 * default of 2500 while config.ts defaults to 800, so with the variable unset —
 * which is how it actually runs — the app promised 2,500 words and the meter cut
 * users off at 800. Two readers, two sources, and the drift was the value
 * itself.
 *
 * Read through getConfig() now. It is the one place the env is parsed, and both
 * the allowance and the meter read it, so a number shown here cannot disagree
 * with the number charged there. A function, not a module constant: config is
 * resolved at boot, and a const evaluated at import time would freeze whatever
 * the env looked like before that.
 */
function freeMonthlyWords(): number {
  return Math.max(0, getConfig().FREE_MONTHLY_WORDS);
}

/**
 * Where the app opens.
 *
 * A first-time user has just finished onboarding and has never seen the inside
 * of the product: You is the tab that sets it up for them — their voices,
 * words, keys and languages — so that is where they land, once.
 *
 * Everyone after that lands on Stats, because it is the only tab that has
 * changed since they last looked. Train is where you go to do something; Stats
 * is what makes reopening the app worth it.
 */
const FIRST_TAB = "personality";
const RETURNING_TAB = "stats";

/**
 * THE TAB ICONS, AS DATA.
 *
 * The backend is the creator and the app is a renderer. Icons were the one
 * place that was quietly untrue: the app matched each tab's id against shapes
 * it carried itself, and the `icon` slot on the tab was never read. A redrawn
 * set meant a release. Now the geometry is here, on a 32-unit grid, and the
 * app draws whatever it is handed — so the next set ships with a cache bump.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT IS NOT ANY MORE.
 *
 * The old three were a conceit about one material: a thread through a node, a
 * thread folded into cloth, a label saying whose it is. It reads beautifully
 * written down and not at all on a phone. Drawn, the node became a small
 * square with a diagonal struck through it, which is the universal sign for
 * NOT ALLOWED; the folded thread became a numeral, which the comment here
 * admitted by adding a fourth row so it would stop reading as a 2; and the
 * label became a luggage tag, which says price, not person.
 *
 * A tab bar is read peripherally, in a fifth of a second, by someone who is
 * not looking at it. It is the one surface in a product where being understood
 * beats being interesting, and three glyphs nobody can name is a navigation
 * bar that has to be learned.
 *
 * So: a waveform, bars, a person. Train is speech becoming writing and a
 * waveform is what speech looks like everywhere. Stats is quantities and bars
 * are quantities. You is a person. None of them is clever and all three are
 * legible at 28 points, which is the size they are actually drawn at.
 *
 * The house style is kept where it costs nothing: one stroke weight family,
 * round caps and joins, the same 32-unit grid, everything optically centred on
 * 16. Active thickens the open strokes and fills the closed one, exactly as
 * before.
 */
/**
 * THE BAR'S TWO TONES.
 *
 * MALT is what the shapes are made of — sampled from the mark's own light
 * squares and warmed until it stops reading as white. PALE is what shows where
 * two of them overlap, lighter than either, so a stack reads as two things and
 * not as one silhouette with a seam.
 *
 * The accent is reserved: it is never the material, only the layer that has
 * been chosen.
 */
const TAB_MALT = "#D8C3A5";
/** The accent, by value. ACCENT_AMBER is declared further down the file and
 *  this block is read while the module is still being evaluated. */
const TAB_ACCENT = "#E8A23C";
const TAB_PALE = "#F3E2C6";

/**
 * DUOTONE, AND THE STATE IS A COLOUR RATHER THAN A SHAPE.
 *
 * At rest every layer is malt, so each icon is one flat silhouette and the bar
 * says nothing. Selected, ONE layer turns to the accent and the overlap turns
 * pale — the shape never moves. Nothing animates into place, nothing has to be
 * learned, and the eye is drawn by warmth rather than by a change of form.
 *
 * Layer order is paint order: back first, then front, then the overlap on top
 * of both. That third layer is drawn geometry rather than a blend mode, which
 * react-native-svg does not have.
 */
/**
 * Two overlapping discs — the You tab's mark.
 *
 * Declared before the set because the set uses it, and a `const` read while
 * the module is still being evaluated has to already exist.
 */
export const TAB_GLYPH_CONTRAST: TabGlyph = {
  layers: [
    {
      d: "M5.80 16.00 A7.2 7.2 0 1 1 20.20 16.00 A7.2 7.2 0 1 1 5.80 16.00 Z",
      fill: true, activeFill: true, color: TAB_MALT,
    },
    {
      // Clearly the smaller of the two, and still substantial. Taken further
      // it stops reading as a pair and starts reading as a satellite.
      d: "M16.20 16.00 A4.6 4.6 0 1 1 25.40 16.00 A4.6 4.6 0 1 1 16.20 16.00 Z",
      fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_ACCENT,
    },
    {
      // The overlap, drawn as its own shape. Two translucent discs would give
      // it for free and would also make the whole glyph translucent, which on
      // art rather than on black is a different colour every screen.
      d: "M18.87 11.83 A7.2 7.2 0 0 1 18.87 20.17 A4.6 4.6 0 0 1 18.87 11.83 Z",
      fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_PALE,
    },
  ],
};

const TAB_GLYPHS: Record<string, TabGlyph> = {
  // TRAIN — two plates, offset, the front one lifting off the back. Two takes
  // on the same thing, which is what this tab does.
  //
  // The corners are cut back along each edge and closed with a quadratic
  // through the original vertex, which is what a rounded corner IS on a shape
  // whose angles are not right angles. A border radius cannot help here.
  home: {
    layers: [
      {
        d: "M13.73 8.76 Q16.00 7.50 18.27 8.76 L22.73 11.24 Q25.00 12.50 22.73 13.76 " +
           "L18.27 16.24 Q16.00 17.50 13.73 16.24 L9.27 13.76 Q7.00 12.50 9.27 11.24 Z",
        fill: true, activeFill: true, color: TAB_MALT,
      },
      {
        d: "M13.73 15.76 Q16.00 14.50 18.27 15.76 L22.73 18.24 Q25.00 19.50 22.73 20.76 " +
           "L18.27 23.24 Q16.00 24.50 13.73 23.24 L9.27 20.76 Q7.00 19.50 9.27 18.24 Z",
        fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_ACCENT,
      },
      {
        d: "M15.34 14.86 Q16.00 14.50 16.66 14.86 L18.04 15.64 Q18.70 16.00 18.04 16.36 " +
           "L16.66 17.14 Q16.00 17.50 15.34 17.14 L13.96 16.36 Q13.30 16.00 13.96 15.64 Z",
        fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_PALE,
      },
    ],
  },

  // STATS — a disc with one slice stepped out of it. The slice is the layer
  // that lights, so what the accent marks is the share, not the whole.
  stats: {
    layers: [
      { d: "M15.30 16.70 L22.39 15.45 A7.2 7.2 0 1 1 16.55 9.61 Z", fill: true, activeFill: true, color: TAB_MALT },
      { d: "M16.57 15.43 L17.82 8.34 A7.2 7.2 0 0 1 23.66 14.18 Z", fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_ACCENT },
    ],
  },

  // YOU — two overlapping discs, the large one plain and the small one lit.
  //
  // The person was the obvious drawing and that is the problem with it: a head
  // on shoulders is the same mark every app in the tray already carries, so
  // the one tab that is about THIS person looked like everyone else's account
  // button. The pair says the same thing sideways — you, and the part of you
  // the app is holding — and it is the only glyph in the bar with an overlap,
  // which is what makes it findable without being read.
  personality: TAB_GLYPH_CONTRAST,
};

/**
 * The person, built and kept for whenever You wants it back. Same rules as the
 * three above: malt at rest, the body to the accent when lit. Unused — swap it
 * into `personality` to use it.
 */
export const TAB_GLYPH_PERSON: TabGlyph = {
  layers: [
    // Body first so the head sits over it.
    { d: "M6.2 26.8 A9.8 9.8 0 0 1 25.8 26.8 Z", fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_ACCENT },
    {
      // Low, sitting ON the shoulders rather than floating above them. A head
      // with air under it reads as a balloon.
      d: "M11.3 12.4 A4.7 4.7 0 1 1 20.7 12.4 A4.7 4.7 0 1 1 11.3 12.4 Z",
      fill: true, activeFill: true, color: TAB_MALT,
    },
  ],
};
/**
 * THE DOCK — three squares close together, not a bar across the screen.
 *
 * Spread across the full width, the three marks stopped being one control.
 * The eye has to travel the whole screen to take them in, nothing says they
 * belong to each other, and the gap between them is decided by the width of
 * the phone rather than by anyone. Pulled together and each given its own
 * ground, they read as one group with three positions in it — which is what a
 * tab bar is — and they say it without a panel drawn behind the lot of them.
 *
 * The ground is what lets them sit on anything. These tabs float over
 * full-bleed art on one tab and a black deck on another; a mark alone has to
 * hope the art behind it is dark, and a mark on its own square never does.
 *
 * 58 with a 19 radius is a squircle, not a circle and not a box — half of 58
 * would be a disc, and a disc under a glyph that is itself made of discs
 * turns the whole thing into a target. 10 between them is close enough to
 * group and far enough that the selected one is clearly one of three.
 */
const TAB_DOCK = {
  size: 58,
  radius: 19,
  gap: 10,
  /** Lighter than black so it reads on the deck, dark enough to sit on art. */
  background: "rgba(30,30,32,0.92)",
  /**
   * The one you are on is a LITTLE lighter, and no more than that. The icon
   * already carries the accent; a lit square as well would put the colour in
   * two places and the eye would go to the bigger one — which is the ground,
   * not the mark.
   */
  activeBackground: "rgba(52,52,56,0.96)",
  lift: 6,
};

function navigationFor(landedBefore: boolean): NavigationShell {
  // NAV is the tabs shell; the narrowing keeps this honest if it ever is not.
  if (NAV.kind !== "tabs") return NAV;
  return {
    ...NAV,
    tabs: NAV.tabs.map((t) => ({ ...t, glyph: TAB_GLYPHS[t.id] })),
    rail: TAB_RAIL,
    dock: TAB_DOCK,
    initialTabId: landedBefore ? RETURNING_TAB : FIRST_TAB,
  };
}

/** The thread across the whole bar behind the icons. false hides it.
 *
 *  Off. The icons became circles that change into something when you choose
 *  them, and a wave running between them turns three quiet marks into a busy
 *  strip. The thread earned its place when the glyphs were outlines competing
 *  with it; against a single dot it is the loudest thing in the bar. */
const TAB_RAIL = false;

const NAV: NavigationShell = {
  kind: "tabs",
  // Settings is no longer a bottom tab — it's reached via the ⚙ gear in the
  // top-right of the header (client renders it on the tab roots). The settings
  // screen itself still exists at screenId "settings" and is pushed on tap.
  tabs: [
    // Home IS the training surface — refine, pick the version that sounds
    // like you, and the style portrait learns from every pick.
    { id: "home", title: "Train", screenId: "home" },
    { id: "stats", title: "Stats", screenId: "stats" },
    { id: "personality", title: "You", screenId: "personality" },
  ],
};

// --- Small Node helpers (keep builders readable) ----------------------------

const text = (content: string, variant = "body", extra: Partial<Node> = {}): Node => ({
  type: "Text",
  props: { content, variant },
  ...extra,
});

const spacer = (height: number): Node => ({ type: "Spacer", style: { height } });

// --- Cache version ----------------------------------------------------------
//
// Opaque token that increments whenever the server catalog changes in a way
// clients should re-fetch. Sent in every bootstrap response as `cacheVersion`;
// clients compare against the value they've stored and drop any locally
// cached screens when it differs. Also bumped on process restart so a code
// deploy invalidates every client on their next bootstrap.

let CACHE_VERSION = `${Date.now().toString(36)}.${Math.floor(Math.random() * 0xffff).toString(36)}`;

/** The current cache-version token clients should compare against. */
export function currentCacheVersion(): string {
  return CACHE_VERSION;
}

/**
 * Bump the token — the next bootstrap every client fetches will carry the new
 * value and any cached screens on the client will be discarded. Called by the
 * admin endpoint (`POST /v1/admin/cache/bump`) and automatically at boot.
 */
export function bumpCacheVersion(): string {
  CACHE_VERSION = `${Date.now().toString(36)}.${Math.floor(Math.random() * 0xffff).toString(36)}`;
  return CACHE_VERSION;
}

// --- Bootstrap --------------------------------------------------------------

/**
 * Should this launch open with a prompt on top of the first screen, and which?
 *
 * A question the user has not answered is worth asking again — but not at the
 * door, and not every time. The rules, in order:
 *
 *   - Never before they have used the app a few times. A prompt on launch two
 *     is onboarding wearing a different hat, which is what we just removed.
 *   - Then periodically, not on every launch, so dismissing it buys real quiet
 *     rather than one screen.
 *   - And it stops for good after a while. Someone who has declined a dozen
 *     times has answered.
 *
 * It resolves itself: the moment the user picks a language the condition is
 * false and the prompt never returns. Every number here is a constant in one
 * place, so the cadence is editable without touching the logic.
 */
const PROMPT_FIRST_LAUNCH = 3;    // not before the 3rd open
const PROMPT_EVERY = 4;           // then every 4th
const PROMPT_GIVE_UP_AFTER = 40;  // and never after the 40th
/** How long to let the user get on with things before the card appears. */
const PROMPT_AFTER_MS = 9000;

function arrivalPrompt(
  opts: { launchCount?: number; languagesSet?: boolean; isReviewer?: boolean },
): string | null {
  // Never in front of a reviewer. A card that appears after nine seconds is a
  // card that appears in the middle of their evaluation.
  if (opts.isReviewer) return null;
  if (opts.languagesSet) return null;
  const n = Number(opts.launchCount ?? 0);
  if (!Number.isFinite(n) || n < PROMPT_FIRST_LAUNCH || n > PROMPT_GIVE_UP_AFTER) return null;
  return (n - PROMPT_FIRST_LAUNCH) % PROMPT_EVERY === 0 ? "languages" : null;
}

export function buildBootstrap(
  opts: {
    onboarded?: boolean;
    /** Has this person ever reached the tab shell before? Decides which tab
     *  the app opens on — see navigationFor. */
    landedBefore?: boolean;
    profileComplete?: boolean;
    launchCount?: number;
    languagesSet?: boolean;
    /** The SERVER's answer, from the entitlements table. The client asks
     *  RevenueCat too, but only this one can lift a server-side cap. */
    entitled?: boolean;
    /** Words used this month, so the app can show the meter and the keyboard
     *  can stop before it starts. */
    wordsUsed?: number;
    /** The user's real ceiling — the plan's words plus what they have earned
     *  by coming back. Null when usage could not be read; the flags then fall
     *  back to the flat free tier, which is the conservative direction. */
    allowance?: Allowance | null;
    /**
     * Which OS is asking.
     *
     * Present so the two platforms can diverge HERE rather than by shipping
     * both variants and letting the device choose. `visibleIf: { platform }`
     * still works and is still the right tool for a small difference inside one
     * screen; this is for the differences that are not small — a flag that must
     * be on for one OS and off for the other, or a screen whose whole shape
     * differs — and for being able to change Android without touching a single
     * byte of what iOS receives.
     */
    platform?: "ios" | "android";
    /** This launch is App Review or Play Review. No intro, no arrival prompt;
     *  the caller already forces onboarded + entitled. */
    isReviewer?: boolean;
    /** The address the auth screen offers a password field for. Empty outside
     *  a submission window, which removes the path entirely. */
    reviewEmail?: string;
    /**
     * WHAT THIS PHONE ALREADY HAS, as reported in the bootstrap capabilities.
     *
     * The microphone permission and the keyboard's Full Access belong to the
     * device, not to the account — so signing out and back in with a different
     * email does not un-grant them. The steps that ask for them are then steps
     * with nothing to ask, and showing them is asking someone to do something
     * they have already done.
     *
     * Both default to false, which shows the steps: a step shown unnecessarily
     * costs a tap, a step skipped wrongly leaves the keyboard never enabled.
     */
    micGranted?: boolean;
    keyboardReady?: boolean;
  } = {},
): BootstrapResponse {
  const nav = navigationFor(!!opts.landedBefore);
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    // Opaque cache token — clients invalidate any cached screens when this
    // changes. Bumps on every process restart plus any admin-triggered bump.
    cacheVersion: CACHE_VERSION,
    // Typefaces to register at boot. Empty by default; the app falls back to
    // the platform font and nothing waits on the network.
    ...(Object.keys(FONTS).length ? { fonts: FONTS } : {}),
    theme: THEME,
    navigation: nav,
    // The server owns onboarding AND the intro. Intro plays whenever all 4
    // frames are uploaded to the media store; falls through to onboarding /
    // home when they're not, so we never render an intro screen with
    // missing images.
    // THE TAB AND THE SCREEN HAVE TO BE THE SAME PLACE.
    //
    // These were decided independently — the tab by `initialTabId`, the screen
    // by pickInitialScreenId — and for a returning user they disagreed: the
    // tab bar lit Stats while the screen showing was Train. The bar is not a
    // label on the screen, it is a claim about where you are, and a bar that
    // lies is worse than a bar that is wrong, because the first tap on the tab
    // you appear to be on does nothing.
    //
    // Only a TAB ROOT is redirected. intro and onboarding come before the tabs
    // exist and must survive this untouched — landing a first-run user on
    // Stats because a tab id says so would skip the two steps that obtain the
    // microphone and the keyboard.
    initialScreenId: landingScreenId(nav, pickInitialScreenId(
      !!opts.onboarded,
      // Uploaded media OR the built-in mark. The intro used to require a file,
      // so out of the box it silently never played — which reads as a broken
      // feature rather than an unconfigured one. It now opens on the brand mark
      // assembling itself, and an upload replaces that.
      !!getMediaRegistryFn?.()?.["intro"]?.url || INTRO_BUILT_IN,
      // Which bootstrap this is, for the whole install. The one thing that can
      // tell "the app is opening" from "the app asked again".
      Number(opts.launchCount ?? 0),
      { micGranted: !!opts.micGranted, keyboardReady: !!opts.keyboardReady },
    )),
    flags: ((): BootstrapResponse["flags"] => {
      const flags: BootstrapResponse["flags"] = {
        // Policy URLs — Settings screen links open these in-browser.
        // Served from tailzu.space (proxied to the backend by Caddy — see
        // deploy/Caddyfile) so the URL a user copies from the address bar looks
        // like a real domain rather than an internal api. host. Same content
        // either way.
        "policy.privacy.url": "https://tailzu.space/privacy",
        "policy.terms.url": "https://tailzu.space/terms",
        "support.url": "mailto:support@tailzu.space",

        // Post-splash intro — max duration + background. `intro.media` is
        // spliced in below from whatever's under the "intro" key in the media
        // registry, so uploading is the entire "swap the intro animation"
        // operation. Absent → client skips the intro entirely.
        "intro.maxDurationMs": 4500,
        "intro.background": THEME.color.bg,
        "intro.showEveryLaunch": false,

        // The Training tab's second door. The screen behind it is a real
        // spoken conversation now, built from modules that already shipped —
        // so this is the whole switch, and turning it off again is one edit.
        "train.realtime": true,

        // Paywall gating. When `paywall.entitlement` is set, the client checks
        // RevenueCat for that entitlement on boot; when the user does NOT
        // have it and `paywall.blockUntilEntitled` is true, the client
        // navigates to the "paywall" screen after onboarding. `paywall.config`
        // is the whole PaywallConfig so clients can pre-warm plan copy without
        // a separate fetch.
        "paywall.entitlement": PAYWALL_CONFIG.entitlement ?? "pro",
        // The app prefers these over its own baked copies. Absent or empty,
        // it falls back to the manifest exactly as before, so a server without
        // them set changes nothing.
        ...(getConfig().REVENUECAT_IOS_KEY
          ? { "billing.revenueCatKey.ios": getConfig().REVENUECAT_IOS_KEY! } : {}),
        ...(getConfig().REVENUECAT_ANDROID_KEY
          ? { "billing.revenueCatKey.android": getConfig().REVENUECAT_ANDROID_KEY! } : {}),
        // What the SERVER believes, alongside what the client asks RevenueCat.
        // The app hides the paywall on either, so a webhook that has not
        // landed yet never leaves a paying user staring at one.
        "billing.entitled": opts.entitled === true,
        "quota.wordsUsed": Math.max(0, Math.round(opts.wordsUsed ?? 0)),
        // The CEILING, earned words included. `quota.wordsFree` keeps its name
        // because every existing client reads it; what changed is that it is no
        // longer a constant. A user who has come back four days running sees
        // 2,900 here, and 2,900 is what the server will enforce.
        "quota.wordsFree": opts.allowance?.total ?? freeMonthlyWords(),
        // The plan's own words, so the app can show the earned part separately.
        "quota.wordsBase": freeMonthlyWords(),
        "quota.wordsEarned": opts.allowance?.earned ?? 0,
        "quota.wordsRemaining": opts.allowance?.remaining
          ?? Math.max(0, freeMonthlyWords() - (opts.wordsUsed ?? 0)),
        // The streak. NOT what tomorrow is worth — that number no longer
        // exists to send, because naming it turns anticipation into
        // arithmetic and a known reward into a price.
        "quota.streakDays": opts.allowance?.streakDays ?? 0,
        "quota.earnMaxed": opts.allowance?.maxed === true,
        // The one flag every gate reads: out of words and not paying.
        "quota.exceeded":
          opts.entitled !== true
          && (opts.wordsUsed ?? 0) >= (opts.allowance?.total ?? freeMonthlyWords()),
        "paywall.blockUntilEntitled": false,
        // DISABLED for now: the paywall was auto-showing on every open (user
        // lacks `pro`) and its purchase fails with "could not complete purchase"
        // because the App Store IAP products aren't purchasable yet (not
        // "Ready to Submit" / Paid Apps Agreement / sandbox tester). That blocked
        // the mic-flow testing. Re-enable (true) once the IAP products are live in
        // App Store Connect + RevenueCat so a purchase actually completes. The
        // paywall screen itself still exists and can be opened manually.
        // The free tier, in WORDS REFINED per month. The app reads this to show
        // progress and to know when to put the paywall in front of someone —
        // without it the client has to guess the number, and a guess that
        // disagrees with the server means a user hitting a wall the UI never
        // warned them about. 0 = unlimited.
        "quota.freeMonthlyWords": freeMonthlyWords(),
        "paywall.showAfterOnboarding": false,
        "paywall.config": PAYWALL_CONFIG as unknown as Record<string, unknown>,

        // Show the native language picker (client-side gliding-greeting screen)
        // right after auth for users who haven't picked a language yet. The
        // flow is: auth → language → "onboarding" (voice permission) →
        // "onboarding_keyboard" (enable keyboard → Settings) → home.
        // postLanguageScreenId is intentionally unset: after the pick the
        // client falls through to initialScreenId, which is "onboarding" for
        // new users and "home" for returning ones.
        // OFF. The pick asked for something the phone already knows, and it
        // was the origin of a stale-language bug: what it stored was the only
        // thing the keyboard ever read, so a later change in Settings did not
        // reach dictation. The app now takes the device's language when
        // nothing is stored, Settings still changes it, and the Languages card
        // asks the better question — which languages, plural.
        //
        // Back to true and the native grid returns, no build.
        "needsLanguagePick": false,

        // A screen to present on top of the first one, this launch only.
        // Absent on most launches. The app pushes it dismissibly — the same
        // shape the soft paywall already uses — so it is a card over the app,
        // not a gate in front of it. Any screen id works here; today the only
        // thing worth asking twice is which languages you speak.
        ...(arrivalPrompt(opts)
          ? {
              promptScreenId: arrivalPrompt(opts)!,
              // Not at the door. A card that lands the instant the app opens
              // interrupts whatever the user came to do, which is the same
              // mistake as asking during onboarding — just later. Waiting a
              // few seconds means it arrives in a pause rather than in the
              // way, and the client drops it entirely if the user starts
              // doing something in the meantime.
              promptAfterMs: PROMPT_AFTER_MS,
            }
          : {}),

        // IN-APP mic capture mode — the app's counterpart to the keyboard's
        // kb.mic.mode, so both surfaces are switchable from here with no app
        // update:
        //   "oneshot" — tap, speak, tap stop; the whole clip is transcribed at
        //               once. Slower to first word, but it's the path that
        //               runs multi-engine fusion, so it's the most ACCURATE.
        //   "live"    — words appear while speaking (WebSocket). Feels faster;
        //               single engine, no fusion.
        // Which engine backs "live" is a separate SERVER-side choice
        // (STT_LIVE_PROVIDER) and needs no client flag at all.
        "voice.mode": "oneshot",

        // The "Hello, name + gender" profile card shows as an overlay on these
        // screen ids. It's placed on the "personality" (You) tab — so right
        // after the activation screen lands the user on You, the card is the
        // first thing they complete there. (Client default is ["home"]; this
        // moves it to You.)
        // "home" as well as "personality": someone whose phone already had the
        // microphone and the keyboard skips both setup steps and opens on
        // home, and the name/gender card is the one thing still owed. Listed
        // here rather than by routing them somewhere else, because home IS
        // where that person belongs — the card is what is missing, not the
        // screen under it.
        "profileGate.screenIds": ["personality", "home"],

        // Flow Session warm-keeping (iOS). When true, the app re-arms the
        // background mic on every foreground so the keyboard dictates WITHOUT
        // reopening the app (the Wispr Flow feel). DISABLED for now: on a build
        // without the "don't publish a live session when the engine failed to
        // start" fix, a failed arm-on-foreground leaves a false-active session
        // that makes every mic tap animate into a dead mic. Re-enable once a
        // build with that arm() hardening ships. Costs background mic time
        // (indicator + battery) either way.
        // Whether the name + gender card has been filled in, ANSWERED BY THE
        // SERVER. It used to be a flag in the phone's own storage, which meant
        // a reinstall or a second device asked the same user again. Their
        // answers live on the profile now, so this follows the account.
        "profile.complete": opts.profileComplete === true,
        // Art behind the name-and-gender card. The app has read this flag
        // since the card was built, and nothing ever served it — the slot was
        // wired at one end only. A plain url, because the card is native and
        // resolves nothing; absent until something is uploaded to
        // `profile.card`, so the card stays as it is today.
        ...(getMediaRegistryFn?.()?.["profile.card"]?.url
          ? { "profileCard.media": getMediaRegistryFn!()["profile.card"]!.url }
          : {}),
        // SMS sign-in. The auth gate runs BEFORE there is a session, so it
        // reads this from the (auth-optional) bootstrap. Off until an SMS
        // provider is actually live in Supabase — turning it on without one
        // gives every user who picks the phone pill a dead end.
        "auth.enablePhone": AUTH_ENABLE_PHONE,
        // The one address that signs in with a password instead of a code.

        // Empty for everyone outside a submission window, and the app draws

        // nothing at all when it is empty.

        "auth.reviewEmail": opts.reviewEmail ?? "",
        "kb.flow.armOnForeground": true,
        "kb.flow.idleTimeoutMs": FLOW_IDLE_TIMEOUT_MS,
        // How each utterance travels to the server. The APP reads this when it
        // arms the session, so it must be in the boot flags as well as the
        // keyboard config — and both must say the same thing.
        "kb.flow.transport": FLOW_TRANSPORT,
      };

      const reg = getMediaRegistryFn?.() ?? {};
      const intro = reg["intro"];
      if (intro?.url && flags) {
        flags["intro.media"] = { url: intro.url };
      }

      // The sign-in screen's backdrop.
      //
      // It rides in the BOOT FLAGS rather than in a screen, because the auth
      // gate runs before there is a session and so can never fetch a screen —
      // bootstrap is the only channel that reaches it. Uploading to `hero.auth`
      // is therefore the entire operation: no deploy, and certainly no build.
      //
      // contentType travels with it because the client has to choose between a
      // Video node and an Image node before it can render anything, and it has
      // no other way to know which this is.
      // The whole sign-in screen. Rides here for the same reason the backdrop
      // does: bootstrap is the only channel that reaches the app before there
      // is a session. The app draws it only when auth.sdui is on, and keeps
      // its own screen as the fallback either way.
      if (flags) {
        flags["auth.sdui"] = AUTH_SDUI;
        flags["auth.scrim"] = AUTH_UI.scrim;
        flags["auth.screen"] = authScreenTree();
        flags["auth.suction"] = AUTH_UI.entry.suction;
      }

      // The code step gets its own backdrop when one is uploaded, and falls
      // back to the entry's when it is not — so a single upload still dresses
      // the whole flow, and a second one is an option rather than a duty.
      const authCodeBg = reg["hero.auth.code"];
      if (authCodeBg?.url && flags) {
        flags["auth.background.code"] = {
          url: authCodeBg.url,
          ...(authCodeBg.contentType ? { contentType: authCodeBg.contentType } : {}),
          background: authCodeBg.present?.background ?? "#000000",
          fit: authCodeBg.present?.fit ?? "cover",
        };
      }

      const authBg = reg["hero.auth"];
      if (authBg?.url && flags) {
        flags["auth.background"] = {
          url: authBg.url,
          ...(authBg.contentType ? { contentType: authBg.contentType } : {}),
          // The screen paints this behind the media so the gap before a video's
          // first frame is the art's own ground rather than a black flash.
          background: authBg.present?.background ?? "#000000",
          fit: authBg.present?.fit ?? "cover",
        };
      }

      // One platform's differences, applied last so they always win.

      return applyPlatformFlags(flags, opts.platform ?? "ios");
    })(),
    // Central copy — every screen can reference these with "@key".
    labels: {
      "app.name": "Tailzu",
      "settings.privacyPolicy": "Privacy Policy",
      "settings.termsOfService": "Terms of Service",
      "settings.support": "Contact Support",
      "onboarding.title": "Welcome To Tailzu",
      "onboarding.subtitle": "Speak Or Type Rough — Tailzu Makes It Sound Like You.",
      "onboarding.cta": "Get Started",

      // Stats screen (see statsScreen). Kept as label refs so localisation
      // controls copy without redeploying the backend.
      "stats.title": "Your usage",
      "stats.hero.subtitle": "This month, in your voice",
      "stats.kv.weekWords": "Words this week",
      "stats.kv.audio": "Audio dictated",
      "stats.kv.saved": "Minutes saved",
      "stats.effort.template":
        "Your effort: you'd have spent {minutes} minutes typing what Tailzu cleaned up in seconds.",
      "stats.sparkline.label": "Requests, last 30 days",
      "stats.cta.history": "See history",

      // History screen (see historyScreen).
      "history.title": "History",
      "history.subtitle":
        "Every cleanup you've kept, newest first. Tap for details, long-press to remove.",
      "history.empty":
        "No history yet. Turn on 'Keep history' in your personality to start collecting your cleanups.",
      "history.detail.toast": "Detail view coming soon",
      "history.delete.error": "Couldn't reach history. Try again.",
    },
    languages: [
      { code: "en", name: "English", greeting: "Hello", regions: ["US","GB","CA","AU","IN"] },
      { code: "hi", name: "हिन्दी", greeting: "नमस्ते", regions: ["IN"] },
      { code: "es", name: "Español", greeting: "Hola", regions: ["ES","MX","AR"] },
      { code: "fr", name: "Français", greeting: "Bonjour", regions: ["FR","CA"] },
      { code: "ar", name: "العربية", greeting: "مرحبا", regions: ["AE","SA","EG"] },
      { code: "pt", name: "Português", greeting: "Olá", regions: ["PT","BR"] },
      { code: "de", name: "Deutsch", greeting: "Hallo", regions: ["DE"] },
      { code: "it", name: "Italiano", greeting: "Ciao", regions: ["IT"] },
      { code: "ru", name: "Русский", greeting: "Привет", regions: ["RU"] },
      { code: "ja", name: "日本語", greeting: "こんにちは", regions: ["JP"] },
      { code: "ko", name: "한국어", greeting: "안녕하세요", regions: ["KR"] },
      { code: "zh", name: "中文", greeting: "你好", regions: ["CN"] },
      { code: "bn", name: "বাংলা", greeting: "নমস্কার", regions: ["BD","IN"] },
      { code: "ta", name: "தமிழ்", greeting: "வணக்கம்", regions: ["IN","LK"] },
      { code: "te", name: "తెలుగు", greeting: "నమస్కారం", regions: ["IN"] },
      { code: "mr", name: "मराठी", greeting: "नमस्कार", regions: ["IN"] },
      { code: "gu", name: "ગુજરાતી", greeting: "નમસ્તે", regions: ["IN"] },
      { code: "pa", name: "ਪੰਜਾਬੀ", greeting: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ", regions: ["IN"] },
      { code: "ur", name: "اردو", greeting: "السلام علیکم", regions: ["PK","IN"] },
      { code: "tr", name: "Türkçe", greeting: "Merhaba", regions: ["TR"] },
      { code: "id", name: "Indonesia", greeting: "Halo", regions: ["ID"] },
      { code: "vi", name: "Tiếng Việt", greeting: "Xin chào", regions: ["VN"] },
      { code: "th", name: "ไทย", greeting: "สวัสดี", regions: ["TH"] },
      { code: "nl", name: "Nederlands", greeting: "Hallo", regions: ["NL"] },
    ],
    // Version gate (dormant: thresholds are at/below the shipped app version, so
    // it won't fire — flip these to force/suggest an update from the server).
    update: {
      minVersion: "0.5.0",
      latestVersion: "1.0.0",
      title: "Update Tailzu",
      message: "A newer version of Tailzu is available with the latest improvements.",
      cta: "Update now",
      url: {
        android: "https://play.google.com/store/apps/details?id=com.tulmi.app",
        // The numeric id is assigned by App Store Connect and is not known
        // until the app exists there, so it comes from the environment. Until
        // APP_STORE_ID is set the key is OMITTED rather than shipped with a
        // placeholder: a gate that says "update now" and opens a dead App
        // Store page is worse than one that says it without a button, and the
        // placeholder id000000000 would have done exactly that on the day this
        // gate first fired.
        ...(APP_STORE_ID ? { ios: `https://apps.apple.com/app/id${APP_STORE_ID}` } : {}),
        default: "https://tailzu.space",
      },
    },
    // The words card wins over a standing announcement. Someone about to be
    // stopped mid-sentence does not need to hear about a feature first, and
    // two cards on one open is one too many.
    ...(() => {
      const card = wordsMilestoneCard(opts) ?? LAUNCH_CARD;
      return card ? { launchCard: card } : {};
    })(),
    cacheTtlSeconds: 300,
    warmScreenIds: WARM_SCREEN_IDS,
  };
}

/**
 * The card the app opens with — the one place to say something to everybody.
 *
 * A new feature to point at, a setup step never finished, an offer running
 * this week. It is a node tree, so there is no card shape to work around: a
 * line and a button, or art and three choices, are the same amount of work
 * here and none at all in the app.
 *
 * TO SHOW A CARD, write one and give it an id nobody has seen. To stop
 * showing it, set this to null. Changing the words of a card people have
 * already seen shows nobody anything — the id is the showing, not the
 * content, so a second announcement needs a second id.
 *
 * Null by default. An app that greets everyone with a card on the day they
 * install it has spent the one moment it had.
 */
/**
 * THE FREE-WORD GATE — every mark, every line and every threshold, in one
 * object, so all of it is edited here and none of it can fall out of step.
 *
 * It used to be a list of numbers beside a map of copy keyed by those exact
 * numbers. That reads fine and is a trap: retuning a mark without editing the
 * map left the lookup undefined and threw on the next bootstrap — for every
 * user at once, from a change that looked like editing a number. One entry
 * carrying its own words cannot do that.
 *
 * COPY IS TEMPLATED, not computed in code. `{used}`, `{left}`, `{total}` and
 * `{streak}` are filled with the reader's own figures, already grouped for
 * their locale. So changing what a card says — including which numbers it
 * says — is editing a string, and a card that mentions no numbers simply
 * mentions none.
 */
export const WORDS_GATE = {
  /**
   * Where a card is worth showing, and what it says there.
   *
   * `at` is a count of words used. Not evenly spaced and not round, because
   * each is a different sentence rather than a step on a meter:
   *
   *   222  the first point where using it is clearly a habit and not a trial.
   *        Early enough to read as news rather than as a bill.
   *   446  about halfway. The only one of the three that is a fact rather
   *        than a nudge, and worth saying plainly.
   *   732  close enough that the next few days decide it — the last moment a
   *        person can act BEFORE being stopped, which is the difference
   *        between an offer and a toll gate.
   *
   * Order does not matter; the latest mark passed is the one that shows.
   * Adding a fourth is one entry. Removing one is deleting it.
   */
  milestones: [
    {
      at: 222,
      kicker: "222 words",
      title: "It is writing for you now",
      body: "That is a habit, not a trial. {left} free words left this month.",
    },
    {
      at: 446,
      kicker: "Halfway",
      title: "Half your free words",
      body: "{used} used, {left} left. Coming back each day earns more.",
    },
    {
      at: 732,
      kicker: "{left} left",
      title: "The month is nearly up",
      body: "Upgrade now and nothing stops mid-sentence.",
    },
  ],
  /** On every milestone card. The way in, and the way out that is not buying. */
  cta: "See plans",
  dismiss: "Not now",
  /** Where both the cards and the out-of-words screen send someone. */
  paywallScreenId: "paywall",
  /** The screen the keyboard's mic diverts to. Named here so the destination
   *  can move without a keyboard build. */
  outScreenId: "words_out",
  /**
   * WHEN THE KEYBOARD CALLS IT "NEARLY OUT".
   *
   * A share of the month's ceiling, floored at a fixed count — a tenth of
   * 2,900 earned words is a warning that arrives while there is still a week
   * of writing left, and a tenth of a small ceiling is not enough words to
   * act on. The floor is roughly one real message, which is what the warning
   * has to be worth to be worth showing.
   */
  lowShare: 0.1,
  lowFloor: 40,
  /** The out-of-words screen. Same templating as the cards. */
  out: {
    kicker: "Out of words",
    title: "That is the month",
    body: "You have used all {total} of your free words. The keyboard still types — it just cannot write for you until they come back.",
    /** Shown only when there IS a streak. "0 days" is not encouragement. */
    streakNote: "{streak} days running. Coming back keeps earning words — upgrading stops the counting.",
    meter: "{used} of {total} used",
    cta: "Get more words",
    back: "Back to typing",
  },
  /** What the keyboard's status line says when it cannot open the app. */
  keyboardStatus: "Out of free words — open Tailzu to get more.",
};

/**
 * Fill {used} / {left} / {total} / {streak} in a line of gate copy.
 *
 * Numbers are grouped before they land, so a template never has to think
 * about it and a line that mentions no numbers is returned untouched.
 */
function wordsCopy(
  line: string,
  figures: { used: number; total: number; streak?: number },
): string {
  const n = (v: number) => Math.max(0, Math.round(v)).toLocaleString("en-US");
  return line
    .replaceAll("{used}", n(figures.used))
    .replaceAll("{left}", n(figures.total - figures.used))
    .replaceAll("{total}", n(figures.total))
    .replaceAll("{streak}", n(figures.streak ?? 0));
}

/**
 * The card for whichever mark was last passed, or none.
 *
 * ONE CARD, THE LATEST — someone who arrives at 800 having never opened the
 * app gets the 732 card, not all three in a queue. And the mark is the id, so
 * the launch-card machinery shows each exactly once without any of this
 * needing to remember what it has said.
 *
 * A card fires when the count PASSES a mark, not when it sits on one. Words
 * land in whole cleanups, so a user goes 210 → 264 and never equals 222; a
 * threshold that had to be hit exactly would fire for almost nobody.
 *
 * Never for someone who has paid, and never for a reviewer: both are being
 * sold something they already have.
 */
function wordsMilestoneCard(opts: {
  entitled?: boolean;
  isReviewer?: boolean;
  wordsUsed?: number;
  allowance?: Allowance | null;
}): LaunchCard | null {
  if (opts.entitled === true || opts.isReviewer) return null;
  const used = Math.max(0, Math.round(opts.wordsUsed ?? 0));
  const total = opts.allowance?.total ?? freeMonthlyWords();
  // Past the ceiling there is a different card with a different job — see the
  // words_out screen. An offer and a stop sign should not arrive together.
  if (used >= total) return null;
  const passed = WORDS_GATE.milestones
    .filter((m) => used >= m.at)
    .sort((a, b) => a.at - b.at);
  const m = passed[passed.length - 1];
  if (!m) return null;
  const fill = (line: string) => wordsCopy(line, { used, total });
  return launchCard({
    // The mark is the id, so each is shown once and a later one still shows.
    id: `words-${m.at}`,
    kicker: fill(m.kicker),
    title: fill(m.title),
    body: fill(m.body),
    cta: WORDS_GATE.cta,
    screenId: WORDS_GATE.paywallScreenId,
    dismiss: WORDS_GATE.dismiss,
  });
}

const LAUNCH_CARD: LaunchCard | null = null;

/**
 * A card, composed. Not exported and not called while LAUNCH_CARD is null —
 * it is the shape to copy when there IS something to say, so that writing one
 * is filling in five strings rather than authoring a tree from nothing.
 *
 * Used by the tests, which hold the wiring in place for the day it is needed:
 * a mechanism that is only exercised the first time it ships is a mechanism
 * that breaks the first time it ships.
 */
export function launchCard(opts: {
  id: string;
  kicker?: string;
  title: string;
  body?: string;
  cta: string;
  screenId: string;
  /** The quiet way out. Omit for a card whose only control is the CTA. */
  dismiss?: string;
  repeat?: "once" | "everyLaunch";
}): LaunchCard {
  return {
    id: opts.id,
    repeat: opts.repeat ?? "once",
    dismissOnBackdrop: true,
    backdrop: "rgba(4,4,6,0.72)",
    sheet: {
      backgroundColor: THEME.color.card,
      borderRadius: THEME.radius.card,
      borderWidth: 1,
      borderColor: THEME.color.border,
      padding: 24,
      width: "100%",
      maxWidth: 360,
    },
    root: {
      type: "Stack",
      children: [
        ...(opts.kicker
          ? [{ type: "Text", props: { content: opts.kicker, variant: "overline" } } as Node]
          : []),
        { type: "Text", props: { content: opts.title, variant: "h1" } },
        ...(opts.body
          ? [{
              type: "Text",
              props: { content: opts.body, variant: "muted" },
              style: { marginTop: 10 },
            } as Node]
          : []),
        {
          type: "Button",
          props: { label: opts.cta },
          style: { marginTop: 22 },
          // An ordinary navigate. The card closes itself on the way out, so
          // this is the same action any other button would carry.
          on: { onPress: { kind: "navigate", screenId: opts.screenId } },
        },
        ...(opts.dismiss
          ? [{
              type: "Button",
              props: { label: opts.dismiss, variant: "ghost" },
              style: { marginTop: 6 },
              on: { onPress: { kind: "dismiss" } },
            } as Node]
          : []),
      ],
    },
  };
}

/**
 * Per-OS flag overrides, applied over the shared set.
 *
 * The flags above are what BOTH platforms get. Anything listed here replaces
 * one of them for one platform only — so an Android-only change can ship
 * without altering a single value iOS receives, and the diff shows exactly
 * which platform it is for.
 *
 * Deliberately a small map rather than branching inside the flag block. A
 * hundred inline ternaries would answer "what is different on Android?" only
 * by reading all of them, and that question gets asked every time either store
 * reports something the other does not.
 */
const PLATFORM_FLAGS: Record<"ios" | "android", Record<string, unknown>> = {
  ios: {},
  android: {
    // Android's own keyboard draws a suggestion strip; iOS's does not.
    "kb.suggestions.enabled": true,
    // Flow Session is an iOS answer to an iOS constraint — an extension there
    // cannot hold the microphone, so the app holds it in the background. The
    // Android IME records inline and needs none of it.
    "kb.flow.armOnForeground": false,
  },
};

function applyPlatformFlags(
  flags: BootstrapResponse["flags"],
  platform: "ios" | "android",
): BootstrapResponse["flags"] {
  return { ...(flags ?? {}), ...PLATFORM_FLAGS[platform] } as BootstrapResponse["flags"];
}

/**
 * The screens an install should hold before it needs them.
 *
 * The client used to warm the four tab destinations and nothing else, so every
 * screen one tap deeper — settings, stats detail, the personality editor —
 * waited on the network the first time it was opened, on every install and
 * again after every cacheVersion bump. That first wait is the one users read as
 * "the app is slow", because it happens exactly when they are exploring.
 *
 * Listed here rather than derived from the switch in buildScreen, because most
 * of what that switch can build should NOT be warmed:
 *
 *   - intro, onboarding, onboarding_keyboard — seen once, and by the time this
 *     list is read the user is past them.
 *   - keyboard_record, flow_arm, keyboard_primer — transient mic screens whose
 *     content only means anything in the moment they are opened.
 *   - anything taking params (personality_detail) — there is no id to warm.
 *
 * paywall IS warmed: it has the heaviest media of any screen, and the moment it
 * appears is the moment a slow load costs money.
 */
const WARM_SCREEN_IDS = [
  "home",
  // One tap from the tab root and it holds the whole refine loop — exactly the
  // "the app is slow" wait this list exists to remove.
  "training_chat",
  "history",
  "stats",
  "personality",
  "settings",
  "languages",
  "voices",
  "dictionary",
  "haptics",
  "paywall",
];

// --- Screens ----------------------------------------------------------------

/**
 * Which screen the app opens on. Runs at bootstrap time so its output is
 * baked into the response the client uses.
 *
 * Onboarding is now a SINGLE activation screen (see onboardingWelcome) — the
 * old intro montage + welcome + language + keyboard-enable sequence collapsed
 * into one. So the routing is simply:
 *   - Not-onboarded → onboarding (the activation screen).
 *   - Otherwise → home.
 * (The separate client-side language greeting still runs before this when the
 * needsLanguagePick flag is set — that's independent of this decision.)
 */
/**
 * Where the app opens.
 *
 * The intro was unreachable until now: this returned only home/onboarding, and
 * no client code routed to "intro" either — so the screen existed, the media
 * key existed, and nothing could ever play it. Uploading a file would not have
 * helped, which is the confusing part of that kind of bug.
 *
 * It plays only when a file is actually there. An intro slot with nothing in it
 * must not cost the user a black screen on the way in.
 *
 * "FIRST RUN" IS A COUNT, NOT A STATE
 *
 * This asked `!onboarded`, and that is a state which stays true for a while —
 * through the auth screen, the language pick, the keyboard step. The client
 * calls this endpoint far more often than once per launch (after sign-in, on
 * every foreground, on every refresh) and it treats the answer as "where the
 * app opens" every time. So a not-yet-onboarded user got the opening film again
 * after signing in, again when the keyboard's mic tap woke the app, and again
 * whenever a foreground reset the stack off a transient mic screen — each time
 * over whatever they had actually asked for, dismissed by a tap, and looking
 * like the film was leaking into the app at random.
 *
 * It was one bug wearing three costumes, and the mistake is in the sentence:
 * an opening plays ONCE, and "once" is counted, not inferred.
 *
 * launchCount is the count. The client bumps a persisted counter on every
 * bootstrap, so the very first call an install ever makes is 1 and there is no
 * second 1 — not after auth, not on foreground, not on any refresh. Everything
 * after that gets home or onboarding, which is what those callers wanted all
 * along.
 *
 * 0 means the client did not say (unreadable storage, an older bundle). That
 * resolves to no intro: a missing opening costs a first impression, a repeating
 * one costs trust in the whole app.
 */
/**
 * The screen that belongs to the tab we are landing on.
 *
 * The tab and the screen used to be decided independently, and for a
 * returning user they disagreed: the bar lit Stats while Train was on screen.
 * A tab bar is not a label on the screen, it is a claim about where you are —
 * and a bar that lies is worse than one that is wrong, because the first tap
 * on the tab you appear to be on does nothing at all.
 *
 * ONLY A TAB ROOT IS REDIRECTED. intro and onboarding come before the tabs
 * exist, and sending a first-run user to Stats because a tab id says so would
 * skip the two steps that obtain the microphone and the keyboard. Anything
 * that is not already a tab's own screen is returned untouched.
 */
function landingScreenId(nav: NavigationShell, picked: string): string {
  if (nav.kind !== "tabs") return picked;
  const isTabRoot = nav.tabs.some((t) => (t.screenId ?? t.id) === picked);
  if (!isTabRoot) return picked;
  const landing = nav.tabs.find((t) => t.id === nav.initialTabId);
  return landing ? (landing.screenId ?? landing.id) : picked;
}

function pickInitialScreenId(
  onboarded: boolean,
  introReady: boolean,
  launchCount: number,
  device: { micGranted?: boolean; keyboardReady?: boolean } = {},
): string {
  const firstEver = launchCount === 1;
  const play = introReady && (
    INTRO_PLAY_WHEN === "everyLaunch" ||
    (INTRO_PLAY_WHEN === "firstRun" && firstEver && !onboarded)
  );
  if (play) return "intro";
  // THE FLAG IS ABOUT THE ACCOUNT. THE MICROPHONE AND THE KEYBOARD ARE ABOUT
  // THE PHONE.
  //
  // `onboarded` outranked the device entirely, and the two are not about the
  // same thing. Sign in on a NEW phone and the flag says the asking is done,
  // so the app opened straight into the tabs on a device that had granted
  // nothing: a microphone that refuses and a keyboard that was never added,
  // with no step anywhere to explain either.
  //
  // The first launch of an install is the one moment the device's answer is
  // worth more than the profile's. It is per-install, so a new phone gets the
  // steps and the phone that already did them is not asked twice.
  //
  // It also cannot become a loop, which is the reason the flag outranked the
  // device in the first place. Declining routes onward and still finishes, and
  // this only ever fires on launch number one — so someone who said no is not
  // returned to the same screen the next time they open the app.
  //
  // launchCount is 0 from a client too old to send it, and 0 is not 1, so
  // those clients keep exactly the behaviour they have now.
  if (launchCount === 1) {
    if (!device.micGranted) return "onboarding";
    if (!device.keyboardReady) return "onboarding_keyboard";
  }
  if (onboarded) return "home";
  // ONBOARDING ONLY ASKS FOR WHAT IT DOES NOT HAVE.
  //
  // Its two steps exist to obtain the microphone and the keyboard, and both
  // are properties of the phone. A second account on the same phone — the
  // same person signing in with a different email — has already granted them,
  // and every step below is skipped in order until one has something to ask.
  //
  // Nothing left to ask means onboarding is done, whatever the profile says:
  // the caller marks it so, and this returns the app.
  if (!device.micGranted) return "onboarding";
  if (!device.keyboardReady) return "onboarding_keyboard";
  return "home";
}

/**
 * THE ALLOW PILL — one control that carries both answers.
 *
 * A light track, a dismiss on the left, and a dark pill taking everything
 * else. The weighting IS the argument: yes is the whole width of the control
 * and no is a glyph, so the recommended path is obvious before a word is read
 * — and the way out is still there, in plain sight, which a permission screen
 * has to offer or it is a wall.
 *
 * It replaces a row of two buttons on both permission steps. Two buttons side
 * by side make the choice look balanced, and it is not: one of them is what
 * the app needs to work and the other is "not yet".
 *
 * Every value is here, so its shape and its colours are a deploy rather than
 * a build.
 */
const ALLOW_PILL = {
  height: 64,
  /** The light track the dark pill floats in. */
  track: "#F4F4F2",
  padding: 6,
  radius: 999,
  /** The dismiss, on the left. Its box is the tap target, not the glyph. */
  dismissWidth: 54,
  dismissColor: "#141416",
  dismissSize: 17,
  dismissStroke: 2.1,
  /** The action. */
  fill: "#0D0D0F",
  color: "#FFFFFF",
  fontSize: 16,
  tracking: 0.1,
  /** Lift, so the control sits above the screen rather than on it. */
  shadowColor: "#000000",
  shadowOpacity: 0.34,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
};

/**
 * Build one. `label` is the promise, `onPress` keeps it, `onDismiss` is the
 * way past. Omit onDismiss and the ✕ is not drawn at all — some screens have
 * nothing to decline.
 */
function allowPill(label: string, onPress: ActionRef, onDismiss?: ActionRef): Node {
  const p = ALLOW_PILL;
  return {
    type: "Stack",
    style: {
      flexDirection: "row",
      alignItems: "center",
      height: p.height,
      borderRadius: p.radius,
      backgroundColor: p.track,
      padding: p.padding,
      shadowColor: p.shadowColor,
      shadowOpacity: p.shadowOpacity,
      shadowRadius: p.shadowRadius,
      shadowOffset: p.shadowOffset,
      elevation: p.elevation,
    },
    children: [
      ...(onDismiss
        ? [{
            type: "Stack",
            on: { onPress: onDismiss },
            style: {
              width: p.dismissWidth,
              height: "100%",
              alignItems: "center",
              justifyContent: "center",
            },
            children: [{
              type: "SVG",
              props: {
                viewBox: "0 0 24 24",
                // Two strokes in one path — a ✕ drawn rather than typed, so it
                // keeps its weight and its soft ends at any size.
                d: "M6 6 L18 18 M18 6 L6 18",
                fill: "none",
                stroke: p.dismissColor,
                strokeWidth: p.dismissStroke,
                strokeLinecap: "round",
              },
              style: { width: p.dismissSize, height: p.dismissSize },
            }],
          } as Node]
        : []),
      {
        type: "Stack",
        on: { onPress },
        style: {
          flex: 1,
          height: "100%",
          borderRadius: p.radius,
          backgroundColor: p.fill,
          alignItems: "center",
          justifyContent: "center",
          // No dismiss means the dark pill is the whole control, so it needs
          // the inset back on the left that the ✕ was standing in.
          marginLeft: onDismiss ? 0 : 0,
        },
        children: [{
          type: "Text",
          props: { content: label },
          style: {
            fontSize: p.fontSize,
            letterSpacing: p.tracking,
            color: p.color,
            fontWeight: "500",
          },
        }],
      },
    ],
  };
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
const HERO_PARTICLE = 208;

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

function heroSlot(opts: {
  id: string;
  mediaKeys: string[];
  style: Record<string, unknown>;
  builtIn: Node;
  frameMs?: number;
  /** The parent screen's own padding, so a "full" presentation can cancel it. */
  bleed?: { x: number; top: number };
  /** What this slot looks like when the entry says nothing. */
  defaultShape?: "full" | "card";
}): Node {
  const override = HERO_OVERRIDES[opts.id];
  if (override) return { ...override, style: { ...opts.style, ...(override.style ?? {}) } };

  const reg = getMediaRegistryFn?.() ?? {};
  const live = opts.mediaKeys.filter((k) => reg[k]?.url);
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
    const inner: Node = isVideo
      ? {
          type: "Video",
          style: fill,
          // A hero is ambient: it plays itself, forever, in silence. Muted is
          // not politeness — an unmuted autoplay is blocked outright.
          props: { source: frames[0], autoplay: true, loop: true, muted: true, contentFit: fit },
          // A bundle without Video draws nothing at all; a still frame is a
          // worse hero than the clip and a far better one than a hole.
          fallback: {
            type: "Image",
            style: fill,
            props: { source: frames[0], contentFit: fit },
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
const INTRO_BUILT_IN = (process.env.INTRO_BUILT_IN ?? "true").toLowerCase() !== "false";
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

/**
 * Daily languages — a multi-select, saved to personality.languages.
 *
 * This is the one question worth asking, and it replaces the single-choice
 * onboarding pick. A person who speaks Hindi AND English is not served by
 * being made to choose: the answer feeds three things at once, and each of
 * them is better with the whole set than with one of it.
 *
 *   - Recognition. Every selected language contributes a short line in its
 *     own script to the recognizer's prompt, which is what stops Hindi
 *     coming back romanized (see sttPrompt).
 *   - Writing. The prompt already states preferred languages/scripts, so
 *     code-switched text is written the way the user actually mixes.
 *   - Order matters. The first selection is the primary — what "auto" falls
 *     back to when nothing else decides.
 *
 * No Save button: each tap writes. A preferences screen that can be left in
 * an unsaved state is a screen that loses answers.
 */
function languagesScreen(ctx: ScreenContext): ScreenResponse {
  const selected = (ctx.personality.languages ?? []).map(String);
  const up = YOU_UI.pill;
  const row = (l: (typeof DAILY_LANGUAGES)[number], _i: number): Node => ({
    // The same pill as every other list on the You screens. A run of pills
    // needs no rules between them: the gap already says where one stops.
    type: "Stack",
    props: { pressOpacity: 0.7 },
    style: {
      flexDirection: "row",
      alignItems: "center",
      gap: up.gap,
      backgroundColor: up.background,
      borderRadius: up.radius,
      paddingLeft: up.paddingLeft,
      paddingRight: 18,
      paddingVertical: up.paddingVertical,
      minHeight: up.minHeight,
      marginBottom: up.marginBottom,
    },
    on: {
      onPress: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "selection" },
          // A plain toggle: tap to select, tap to unselect, including the
          // last one. Clearing the set is a real answer — the recognizer
          // falls back to the single language hint, which is exactly how it
          // behaved before this card existed. A row that refuses to
          // deselect reads as broken, and the degradation here is mild.
          { kind: "toggleInArray", path: "langs", value: l.value },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/personality",
            body: { languages: "$state.langs" },
            onError: "err",
          },
        ],
      },
    },
    children: [
      {
        type: "Stack",
        style: { flex: 1, gap: 1 },
        children: [
          { type: "Text", props: { content: l.label },
            style: { fontSize: up.labelSize, fontWeight: "600", color: YOU_UI.text } },
          { type: "Text", props: { content: l.native },
            style: { fontSize: up.subSize, color: YOU_UI.textDim } },
        ],
      },
      // The tick is the whole state display: present means selected. Rendered
      // from `langs`, so it follows the tap without a refetch. Amber, not the
      // theme's primary — primary is WHITE here, and a white tick on a pill
      // reads as another piece of the label rather than as the answer.
      {
        type: "Text",
        visibleIf: { contains: ["langs", l.value] },
        props: { content: "✓" },
        style: { fontSize: 17, fontWeight: "800", color: YOU_UI.accent },
      },
    ],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "languages",
    title: "",
    // Seeded from the saved set so the ticks are right on open, and mutated
    // in place by every tap after that.
    state: { langs: selected },
    actions: {
      err: { kind: "toast", message: "Couldn't save that. Try again.", tone: "error" },
    },
    // The amber block reaches the top of the window, so the app's own header
    // has to go. The block carries the way back in its place.
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        // No hero. The amber block IS the top of this screen now, and a banner
        // above it would put two different treatments in the first 200 points.
        // The art it used to carry is on the deck card that opens this screen.
        youHead("Tap each one you use.", "Languages"),
        {
          type: "Screen",
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: YOU_UI.padding, paddingTop: 20, paddingBottom: 28,
          },
          children: DAILY_LANGUAGES.map(row),
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

function introScreen(ctx: ScreenContext): ScreenResponse {
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
          props: { background: "#FFFFFF", circular: true },
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
        ...(hasIntroMedia && introIsVideo ? [{
          type: "Video",
          style: shown.style,
          props: {
            source: introSource,
            autoplay: true, loop: false, muted: true, contentFit: shown.fit,
            // Where the mark is in the film, and where it must land in the box.
            // Without these the box is centred and the mark is wherever the art
            // put it — which is what the launch screen never agrees with.
            ...shown.place,
          },
          on: { onComplete: "done" },
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

// ---------------------------------------------------------------------------
// Paywall — a backend-authored subscription screen.
// ---------------------------------------------------------------------------
//
// The whole thing is data: media, copy, plan cards, CTA all come from
// PAYWALL_CONFIG below. Swap that constant → the paywall changes, no client
// rebuild. RevenueCat is the store engine; iap.showPaywall drives purchase.
//
// A plan card:
//   - Renders label + price + optional badge + optional footnote.
//   - Tap sets `state.selectedPlanId` (haptic on tap).
//   - Selected card gets a themed border + fill.
// Primary CTA reads `state.selectedPlanId`, looks the plan up, and fires
// iap.showPaywall with the plan's offeringId/packageId, or iap.subscribe if
// only productId is set.
//
// Everything below the plans is optional — the CTA is the only required
// element. Set `dismissible: false` for a hard paywall (no "×"/close).

/**
 * The paywall's LAYOUT, apart from its content.
 *
 * PAYWALL_CONFIG says what is sold; this says where it sits on the art. They
 * are separate because they change for different reasons — a price changes
 * with the business, the composition changes with whatever was uploaded last.
 */
export const PAYWALL_UI = {
  /**
   * Which end of the screen the plan rows sit at.
   *
   * "bottom" is the poster reading: art above, offer beneath, the shape of
   * every app-store screenshot. "top" is for art whose subject is in the
   * lower half and would be covered by rows sitting on it — which is a
   * property of the upload, not of the paywall, so it is a value here and not
   * a rewrite.
   *
   * The scrim follows automatically. It has to: rows are only legible over an
   * unknown image because something darkens the end they sit at.
   */
  plansAt: "top" as "top" | "bottom",
  /** Clear of the status bar and the ✕ when the plans are at the top. */
  paddingTop: 104,
  paddingBottom: 24,
  paddingHorizontal: 16,
  /** Transparent where the art shows, opaque where the rows are. */
  scrim: ["rgba(0,0,0,0)", "rgba(0,0,0,0.20)", "rgba(0,0,0,0.80)", "rgba(0,0,0,0.94)"],
  scrimStops: [0, 0.4, 0.72, 1],
  /**
   * The auto-renewal line under the rows.
   *
   * Quiet, but not decorative — both stores require this sentence to be on the
   * screen where the purchase happens, so it has to be legible over whatever
   * art someone uploads, which is the scrim's job above and this colour's job
   * here. Do not take it below the muted step.
   */
  footnoteColor: "rgba(255,255,255,0.55)",
};

export const PAYWALL_CONFIG: PaywallConfig = {
  // Empty on purpose: with no frames the paywall renders BinaryReveal — the
  // wordmark decoding out of 0s and 1s on a loop. Add keys back here and the
  // uploaded art takes over instead.
  heroFrames: [],
  heroFrameMs: 2200,
  heroLoops: 0,
  title: "Type once. Sound like you always.",
  subtitle: "Unlock unlimited voice cleanups, every tone, every language.",
  features: [
    "Unlimited voice-to-text refinement",
    "All 12 personality presets + tones",
    "Priority speech recognition",
    "Cancel anytime",
  ],
  // Two auto-renewing tiers, branded Lite (monthly) / Elite (annual). Both
  // grant the same `pro` entitlement — they differ only by billing period.
  // productId MUST match the App Store product exactly (see below); packageId is
  // RevenueCat's built-in duration slot ($rc_monthly / $rc_annual). Prices are
  // DISPLAY COPY — set the real prices in App Store Connect and keep in sync (or
  // ask to switch the paywall to live RevenueCat prices). Elite first;
  // `default: true` pre-selects it.
  plans: [
    {
      // BITE — the free tier, shown but not sold.
      //
      // A paywall listing only paid tiers implies the free one has run out or
      // never existed. Standing it next to Lite and Elite is what makes the
      // other two read as a choice rather than a toll.
      //
      // NO NUMBER HERE. It is filled in by paywallScreen from the allowance the
      // server actually enforces, because writing "800" in this file would be a
      // promise the backend never agreed to — and the day the allowance moves,
      // the paywall would keep quoting the old one to everyone who reads it.
      //
      // It cannot be computed here either: this object is built when the module
      // is imported, and config is resolved after that, so anything read at this
      // point is whatever the environment looked like before boot.
      id: "free",
      free: true,
      label: "Stay free",
      price: "",
      /** One line, and it is the number that makes the paid rows read as a
       *  choice. Filled from the allowance the server actually enforces. */
      note: "",
    },
    {
      id: "annual",
      // VERIFIED against the RevenueCat dashboard (entitlement "TAILZU AIR",
      // Associated products): "tailzu_annu" is the exact full identifier.
      productId: "tailzu_annu",
      offeringId: "default",
      packageId: "$rc_annual",
      // THE TIER'S NAME, not its billing period.
      //
      // "Yearly" said the period twice — the row already carries it in the
      // price line and again in the commitment note below it — and said the
      // product's name nowhere. Both stores list these as Elite and Lite, so
      // a customer who checks their subscriptions sees a name the app never
      // showed them.
      //
      // The period disclosure both stores require is unaffected: it lives in
      // `period` and `note`, which is why the name could move into `label` at
      // all. Do not remove either of those to make room for anything.
      label: "Elite",
      price: "$59.99",
      period: "$5.00 / mo, billed yearly",
      // With no confirm button, the ROW is where the commitment gets
      // disclosed — which is also what the stores require before a purchase.
      note: "7 days free, then billed yearly",
      badge: "Save 50%",
      default: true,
    },
    {
      id: "monthly",
      // VERIFIED against the RevenueCat dashboard: "TAILZU_MONT" is exact.
      productId: "TAILZU_MONT",
      offeringId: "default",
      packageId: "$rc_monthly",
      label: "Lite",
      price: "$9.99",
      period: "per month",
      note: "Billed monthly, cancel anytime",
    },
  ],
  /**
   * NOT DRAWN, and required by the type rather than by the screen.
   *
   * This paywall has no confirm button: tapping a plan row IS the purchase,
   * which is why each row carries its own commitment line. A single CTA under
   * the rows would also have had to lie on one of them — "Start free trial"
   * is true of the annual plan and false of the monthly one.
   */
  cta: "Start free trial",
  restoreLabel: "Restore purchases",
  footnote:
    "Auto-renews unless canceled 24h before period end. Manage in Settings.",
  terms: "https://tailzu.space/terms",
  privacy: "https://tailzu.space/privacy",
  dismissible: true,
  dismissLabel: "Not now",
  // The RevenueCat entitlement IDENTIFIER (case/space-sensitive). The app calls
  // hasEntitlement(this). Per the RevenueCat dashboard the Identifier is
  // "TAILZU AIR" — "ON AIR" is only the Display Name, which the SDK does NOT
  // match on. Products tailzu_annu (Elite) + TAILZU_MONT (Lite) are attached to
  // this entitlement, so once a purchase completes the app unlocks.
  entitlement: "TAILZU AIR",
};

/**
 * "paywall" SDUI screen. Renders a scrollable page:
 *   [close] [hero media Slideshow]
 *   [title / subtitle]
 *   [feature bullets]
 *   [plan cards row]
 *   [primary CTA sticky-ish at the bottom]
 *   [restore + terms + privacy]
 *
 * Selection state lives in `state.selectedPlanId`. CTA action tree branches
 * on that value to fire the right iap.showPaywall (offering+package) or
 * iap.subscribe (product).
 */
function paywallScreen(): ScreenResponse {
  const cfg = PAYWALL_CONFIG;
  const pw = PAYWALL_UI;
  /**
   * WHICH END OF THE SCREEN THE PLANS SIT AT, and therefore which end the
   * scrim darkens. The two cannot be set separately: a scrim that falls away
   * at the bottom under rows pinned to the top is rows on bare art, and the
   * pairing is the only thing keeping them readable over an upload nobody has
   * seen yet.
   */
  const atTop = pw.plansAt === "top";
  const scrimStops = atTop ? [...pw.scrim].reverse() : pw.scrim;
  const scrimAt = atTop
    ? [...pw.scrimStops].reverse().map((s) => 1 - s)
    : pw.scrimStops;
  // The cards that can actually be bought. A `free` plan is a card and nothing
  // else: no purchase action is built for it, the CTA chain never dispatches to
  // it, and it can never become the fallback — a CTA aimed at a plan with no
  // product id is a button that fails in front of the user, every time.
  const sellable = cfg.plans.filter((p) => !p.free);
  const defaultPlan = sellable.find((p) => p.default) ?? sellable[0];

  // One action per plan — the CTA references the currently-selected one
  // via a `condition` chain.
  const planActions: Record<string, ActionRef> = {};
  sellable.forEach((plan) => {
    planActions[`buy.${plan.id}`] = {
      kind: "sequence",
      actions: [
        { kind: "haptic", style: "medium" },
        plan.offeringId
          ? {
              kind: "iap.showPaywall",
              offeringId: plan.offeringId,
              packageId: plan.packageId,
              onSuccess: "unlocked",
              onError: "purchaseFailed",
            }
          : {
              kind: "iap.subscribe",
              productId: plan.productId ?? plan.id,
              onSuccess: "unlocked",
              onError: "purchaseFailed",
            },
      ],
    };
  });

  // CTA chain: check selectedPlanId, dispatch to matching buy.* action.
  const ctaCondition: ActionRef = sellable.reduceRight<ActionRef>(
    (acc, plan) => ({
      kind: "condition",
      if: { eq: ["selectedPlanId", plan.id] },
      then: `buy.${plan.id}`,
      else: acc,
    }),
    `buy.${defaultPlan.id}`,
  );

  const actions: Record<string, ActionSpec> = {
    ...(planActions as Record<string, ActionSpec>),
    cta: ctaCondition as ActionSpec,
    unlocked: {
      kind: "sequence",
      actions: [
        { kind: "haptic", style: "success" },
        { kind: "toast", message: "You're in.", tone: "success" },
        { kind: "navigate", screenId: "home" },
      ],
    },
    purchaseFailed: {
      kind: "toast",
      message: "Couldn't complete purchase.",
      tone: "error",
    },
    restore: {
      kind: "sequence",
      actions: [
        { kind: "iap.restore", onSuccess: "restoreDone" },
      ],
    },
    restoreDone: {
      kind: "toast",
      message: "Purchases restored.",
      tone: "success",
    },
    dismiss: { kind: "navigateBack" },
    openTerms: { kind: "openUrl", url: cfg.terms ?? "https://tailzu.space/terms", external: true },
    openPrivacy: { kind: "openUrl", url: cfg.privacy ?? "https://tailzu.space/privacy", external: true },
  };

  // heroFrames is gone with the slideshow it fed. The pitch is one piece of
  // art in the `paywall` media slot now, behind everything, rather than a
  // carousel above a wall of copy that no longer exists.

  /**
   * A PLAN IS A BUTTON. There is no confirm step.
   *
   * Choosing and buying were two acts, and with the benefit list gone the
   * second one carried no new information — it asked the same question again.
   * The row commits, so the row is also where the terms are stated, which is
   * what the stores require before a purchase rather than after.
   */
  const planRow = (plan: PaywallPlan): Node => ({
    type: "Stack",
    on: { onPress: plan.free ? "dismiss" : `buy.${plan.id}` },
    props: {
      pressOpacity: 0.82,
      // NO BORDER UNTIL A FINGER IS ON IT.
      //
      // Every row here is selectable, so a border on all of them says nothing
      // about which one is being chosen — it is just the loudest thing a row
      // can wear, worn by everything. Drawn on press, it says exactly that and
      // nothing the rest of the time.
      pressBorderColor: plan.free ? "rgba(255,255,255,0.28)" : ACCENT_AMBER,
      pressBorderWidth: 1,
    },
    style: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: 16,
      paddingVertical: 13,
      paddingHorizontal: 15,
      marginBottom: 8,
      // The paid rows are the way through, so they carry the brand — now in
      // the fill alone, which is quieter and still unmistakable.
      backgroundColor: plan.free ? "rgba(255,255,255,0.05)" : "rgba(232,162,60,0.12)",
    },
    children: [
      {
        type: "Stack",
        style: { flex: 1 },
        children: [
          { type: "Text", props: { content: plan.label },
            style: { fontSize: 15, fontWeight: "500", color: "#FFFFFF" } },
          ...(plan.note
            ? [{ type: "Text", props: { content: plan.note },
                 style: { fontSize: 11, color: "rgba(255,255,255,0.52)", marginTop: 1 } } as Node]
            : []),
        ],
      },
      ...(plan.price
        ? [{
            type: "Stack",
            style: { alignItems: "flex-end" },
            children: [
              { type: "Text", props: { content: plan.price },
                style: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" } },
              ...(plan.period
                ? [{ type: "Text", props: { content: plan.period },
                     style: { fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 1 } } as Node]
                : []),
            ],
          } as Node]
        : []),
      // The arrow. It is what says a row goes somewhere rather than selects.
      {
        type: "Stack",
        style: {
          width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
          backgroundColor: plan.free ? "rgba(255,255,255,0.10)" : ACCENT_AMBER,
        },
        children: [{
          type: "SVG",
          props: {
            viewBox: "0 0 24 24", d: "M9 5 L16 12 L9 19", fill: "none",
            stroke: plan.free ? "rgba(255,255,255,0.6)" : "#0B0B0D", strokeWidth: 2.6,
          },
          style: { width: 11, height: 11 },
        }],
      },
    ],
  });

  const tiny = (label: string, action: ActionRef): Node => ({
    type: "Stack",
    on: { onPress: action },
    style: { paddingHorizontal: 7, paddingVertical: 4 },
    children: [{ type: "Text", props: { content: label },
      style: { fontSize: 9.5, color: "rgba(255,255,255,0.34)" } }],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "paywall",
    title: "",
    // Full bleed. The paywall owns the window — no header, no tabs.
    hideChrome: true,
    state: { selectedPlanId: defaultPlan.id },
    actions,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: "#000000" },
      children: [
        // The pitch. With the headline and the benefit list gone, the art is
        // the whole argument — so it is not painted over until something has
        // to be read.
        ...screenHero("paywall", {
          behind: true, fit: "cover",
          // Until something is uploaded, the wordmark decoding itself out of
          // binary. The product's claim is that it turns raw noise into
          // finished words; this is that claim made literal at the moment the
          // user is deciding whether to believe it — and it is what keeps this
          // screen from being plain black on a fresh install.
          builtIn: {
            type: "BinaryReveal",
            props: {
              text: "Tailzu",
              color: THEME.color.primary,
              background: "#000000",
              flipMs: 36,
              lockMs: 70,
              scrambleMs: 620,
              holdMs: 2200,
              fontSize: 46,
            },
            fallback: {
              type: "Heading",
              props: { content: "Tailzu" },
              style: { fontSize: 46, fontWeight: "800", color: THEME.color.primary },
            },
          },
        }),
        {
          type: "Gradient",
          props: { colors: scrimStops, locations: scrimAt, direction: "vertical" },
          style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
        },
        ...(cfg.dismissible
          ? [{
              type: "Stack",
              on: { onPress: "dismiss" },
              style: {
                position: "absolute", top: 56, right: 16, width: 32, height: 32,
                borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)",
                alignItems: "center", justifyContent: "center",
              },
              children: [{
                type: "SVG",
                props: { viewBox: "0 0 24 24", d: "M6 6 L18 18 M18 6 L6 18",
                         fill: "none", stroke: "#FFFFFF", strokeWidth: 2.4 },
                style: { width: 12, height: 12 },
              }],
            } as Node]
          : []),
        {
          type: "Stack",
          style: {
            flex: 1,
            justifyContent: atTop ? "flex-start" : "flex-end",
            paddingHorizontal: pw.paddingHorizontal,
            paddingTop: atTop ? pw.paddingTop : 0,
            paddingBottom: atTop ? 0 : pw.paddingBottom,
          },
          children: [
            // Not a headline — a label on what is being bought.
            { type: "Text", props: { content: cfg.title ? "Tailzu Unlimited" : "" },
              style: { fontSize: 9, letterSpacing: 3, textTransform: "uppercase",
                       color: "rgba(255,255,255,0.5)", textAlign: "center", marginBottom: 14 } },
            // PAID FIRST. The free row is the way out, and a way out listed
            // above the offer reads as the recommendation.
            ...[...cfg.plans].sort((a, b) => Number(!!a.free) - Number(!!b.free))
              .map((plan) => planRow(
                plan.free
                  ? { ...plan, note: plan.note || `${freeMonthlyWords().toLocaleString()} words a month` }
                  : plan,
              )),
            // THE AUTO-RENEWAL DISCLOSURE, which was written and never drawn.
            //
            // It sat in PAYWALL_CONFIG.footnote and nothing rendered it, so
            // the screen where the purchase happens never said the thing both
            // stores require it to say: that this renews by itself until it is
            // cancelled. The rows carry the price and the period; this is the
            // sentence that turns those into terms.
            //
            // It goes ABOVE the restore/terms/privacy row rather than below
            // it, because it is a condition of the thing just above it and not
            // a piece of chrome at the foot of the screen.
            ...(cfg.footnote
              ? [{
                  type: "Text",
                  props: { content: cfg.footnote, variant: "caption" },
                  style: {
                    textAlign: "center", marginTop: 12,
                    paddingHorizontal: 8, color: pw.footnoteColor,
                  },
                } as Node]
              : []),
            {
              type: "Stack",
              style: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
              children: [
                tiny(cfg.restoreLabel ?? "Restore", "restore"),
                tiny("Terms", "openTerms"),
                tiny("Privacy", "openPrivacy"),
              ],
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 300,
  };
}

export interface ScreenContext {
  personality: Personality;
  language: string;
  email?: string;
  /** Set instead of `email` for an SMS-only account. */
  phone?: string;
  usage?: UsageSummary;
  /** Words available and words earned, for the stats meter. Absent for a
   *  signed-out or unreadable user; the meter is then not drawn at all rather
   *  than drawn with zeros, which would read as "you have nothing left". */
  allowance?: Allowance | null;
  /**
   * Optional per-user stats projection for the "stats" screen. Populated by
   * the screen route handler when it has been wired to fetch statsForUser();
   * when absent, the stats screen falls back to the numbers in `usage`.
   */
  stats?: StatsResponse;
  /** Pre-fetched history for the "history" screen (optional; the screen also
   * refetches via callEndpoint on mount for freshness). */
  history?: HistoryEntry[];
  name?: string;
  /** Whether the user has completed onboarding — routes the intro's `done`
   * action to onboarding (new user) vs home, so the intro never skips it. */
  onboarded?: boolean;
  dictionary?: Array<{ word: string; replacement: string }>;
  frequentWords?: string[];
  /** Deep-link / navigation params — e.g. keyboard_record receives
   * { session, host } from the keyboard extension's tulmi://s/... URL. */
  params?: Record<string, string | number | boolean | undefined>;
  /**
   * Which OS is asking. Defaults to iOS for a client that does not say.
   *
   * Lets a screen be BUILT differently per platform rather than built once
   * with both branches inside it. Prefer `visibleIf: { platform }` for a
   * single node; use this when the difference is structural, or when an
   * Android change must not alter the bytes iOS receives.
   */
  platform?: "ios" | "android";
}

export function buildScreen(screenId: string, ctx: ScreenContext): ScreenResponse | null {
  switch (screenId) {
    case "home":
      return homeScreen(ctx);
    case "training_chat":
      return trainingChatScreen(ctx);
    case "training_live":
      return trainingLiveScreen();
    case "dictionary":
      return dictionaryScreen(ctx);
    case "haptics":
      return hapticsScreen(ctx);
    case "language_select":
      return languageSelectScreen(ctx);
    case "languages":
      return languagesScreen(ctx);
    case "delete_account":
      return deleteAccountScreen();
    case WORDS_GATE.outScreenId:
      return wordsOutScreen(ctx);
    case "reply":
      return replyScreen();
    case "personality":
      return personalityScreen(ctx);
    case "voices":
      return voicesScreen(ctx);
    case "tone_edit":
      return toneEditScreen(ctx);
    case "personality_customize":
      return personalityCustomizeScreen(ctx.personality);
    case "personality_edit":
      return personalityEditScreen(
        ctx.personality,
        typeof ctx.params?.presetId === "string" ? ctx.params.presetId : undefined,
      );
    case "personality_detail":
      return personalityDetailScreen(
        ctx.personality,
        typeof ctx.params?.presetId === "string" ? ctx.params.presetId : undefined,
      );
    case "settings":
      return settingsScreen(ctx);
    case "stats":
      return statsScreen(ctx);
    case "history":
      return historyScreen(ctx);
    case "onboarding":
      return onboardingVoice();
    // "onboarding_language" removed — the language pick is the client's native
    // post-auth screen now (needsLanguagePick bootstrap flag). Unknown ids fall
    // through to null → 404, which the client surfaces gracefully.
    case "onboarding_keyboard":
      return onboardingKeyboard();
    case "keyboard_record":
      return keyboardRecordScreen(ctx);
    case "keyboard_primer":
      return keyboardPrimerScreen(ctx);
    case "flow_arm":
      return flowArmScreen(ctx);
    case "intro":
      return introScreen(ctx);
    case "paywall":
      return paywallScreen();
    default:
      return null;
  }
}

/** Languages offered in onboarding + settings. */
/**
 * The languages a user can say they speak day to day.
 *
 * Wider than LANGUAGES (the single output-language picker) and ordered by who
 * actually uses Tailzu: the Indic set first, then the rest. Each carries its
 * own name in its own script, because a list of English names is a worse
 * question — a Marathi speaker looks for "मराठी".
 *
 * `value` doubles as the STT exemplar key (see sttPrompt), so adding a row
 * here is all it takes for that language's script to prime the recognizer.
 */
const DAILY_LANGUAGES: Array<{ value: string; label: string; native: string }> = [
  { value: "en", label: "English", native: "English" },
  { value: "hi", label: "Hindi", native: "हिन्दी" },
  { value: "hinglish", label: "Hinglish", native: "Hindi + English, in Latin script" },
  { value: "mr", label: "Marathi", native: "मराठी" },
  { value: "bn", label: "Bengali", native: "বাংলা" },
  { value: "ta", label: "Tamil", native: "தமிழ்" },
  { value: "te", label: "Telugu", native: "తెలుగు" },
  { value: "gu", label: "Gujarati", native: "ગુજરાતી" },
  { value: "kn", label: "Kannada", native: "ಕನ್ನಡ" },
  { value: "ml", label: "Malayalam", native: "മലയാളം" },
  { value: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { value: "ur", label: "Urdu", native: "اردو" },
  { value: "es", label: "Spanish", native: "Español" },
  { value: "fr", label: "French", native: "Français" },
  { value: "de", label: "German", native: "Deutsch" },
  { value: "pt", label: "Portuguese", native: "Português" },
  { value: "ar", label: "Arabic", native: "العربية" },
  { value: "ru", label: "Russian", native: "Русский" },
  { value: "ja", label: "Japanese", native: "日本語" },
  { value: "ko", label: "Korean", native: "한국어" },
  { value: "zh", label: "Chinese", native: "中文" },
];

/**
 * The brand accent — the warm amber sampled from the mic animation.
 *
 * The theme's `primary` is WHITE by design (black surface, white CTAs), so
 * anything reaching for `THEME.color.primary` to get "the brand colour" gets
 * white and silently disappears. That is exactly what happened to the
 * Languages heading. The accent has been living as a scattered literal;
 * this is the name the theme comment has always claimed exists.
 */
const ACCENT_AMBER = "#E8A23C";

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "hinglish", label: "Hinglish" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "ar", label: "Arabic" },
  { value: "pt", label: "Portuguese" },
];

/**
 * Every string, every gap and every media slot in the Training tab, in one
 * place.
 *
 * The point of this object is that the screens below read from it and hold no
 * literals of their own. Changing where the copy block sits, how far the art
 * bleeds, how strongly the background is veiled, or which of the two doors
 * exists is an edit HERE and a deploy — never a build, never an OTA.
 *
 * Media is separate again: `hero.training` and `hero.training_chat` are
 * registry keys, so the art itself changes by upload with no code change at
 * all. Both slots are optional — screenHero returns nothing for an empty key,
 * and both screens are designed to read correctly with no art behind them.
 */
/**
 * How many rows the chat thread keeps. Old rows drop off the front.
 *
 * A conversation is state on the device, not history on the server — nothing
 * here is stored — so the only thing that grows is what the screen has to
 * draw. Sixty is far more than anyone scrolls back through and well under
 * where a re-render starts to cost anything.
 */
const THREAD_MAX = 60;

/**
 * Whether the app draws the server-composed sign-in screen or its own.
 *
 * OFF until the screen has been seen working on a device. This is the whole
 * revert: the native screen stays in the binary and stays the thing that owns
 * the auth logic, so flipping this back is a deploy and nobody is ever locked
 * out waiting for a build.
 */
const AUTH_SDUI = true;

/**
 * The sign-in screen, in one object.
 *
 * Auth was the last screen the server did not compose. Not for a technical
 * reason — bootstrap reaches the app before there is a session — but because
 * the pills and the native sign-in buttons had no registry entries. Those
 * shipped; this is the screen built out of them.
 *
 * Everything below is a string, a size, a spacing or a duration. There is no
 * logic here and there must never be: the flow still lives in the app, because
 * a sign-in screen composed by a server that is having a bad day has to still
 * be a sign-in screen. This decides how it LOOKS.
 */
const AUTH_UI = {
  brand: "Tailzu",
  tagline: "You talk. It writes.",

  /** The window. hideChrome is on, so this padding IS the safe area. */
  paddingHorizontal: 28,
  paddingBottom: 42,
  paddingTop: 72,

  /** How dark the scrim over the uploaded backdrop is. 0 shows the art raw. */
  scrim: 0.42,

  /**
   * The pill itself, for both methods. Every key here is forwarded to
   * SwipePill and lands on what draws; anything left out keeps the shipped
   * value, so this can be as small as one line.
   */
  pill: {
    // A dimmer amber than the brand's own. Full #E8A23C is the brightest thing
    // in a dark window by a distance and reads as a warning rather than an
    // invitation; pulled down it still says "go" without shouting.
    targetBackground: "#C9862B",
    targetIconColor: "#000000",
  },

  entry: {
    gap: 16,
    brandSize: 34,
    brandGap: 6,
    taglineSize: 14,
    /** Space between the copy block and the first pill. */
    blockGap: 34,
    /** When each pill nudges its badge to advertise the swipe. */
    hintDelayMs: 1100,
    hintStaggerMs: 160,
    social: { size: 52, gap: 16, topGap: 22 },
    /**
     * The entrance, PER ELEMENT.
     *
     * There is no stagger index and no "which one am I" — each row carries its
     * own delay. A stagger computed from position means the order is decided by
     * the layout and can only be changed by moving things; a delay per row means
     * the socials can arrive first, or two rows can land together, or the brand
     * can be held back a beat, without touching the composition.
     *
     * Bottom-up as shipped: socials leave the floor first, the brand settles
     * last. `spring` is the shape, shared unless a row overrides it — lower
     * damping overshoots more, higher stiffness lands sooner.
     */
    suction: {
      spring: { damping: 14, stiffness: 110, mass: 0.9 },
      scaleFrom: 0.86,
      // Kept so an older bundle, which reads these three and computes its own
      // stagger, still animates rather than snapping in.
      staggerMs: 95,
      durationMs: 780,
      fromY: 120,
      rows: {
        brand:   { delayMs: 285, fromY: 90 },
        email:   { delayMs: 190, fromY: 120 },
        phone:   { delayMs: 95,  fromY: 120 },
        socials: { delayMs: 0,   fromY: 120 },
        codeTitle: { delayMs: 120, fromY: 80 },
        codePill:  { delayMs: 0,   fromY: 110 },
        // Last in, and barely travels. It is the smallest thing on the screen
        // and should settle rather than arrive.
        legal:   { delayMs: 380, fromY: 40 },
      },
    },
  },

  /**
   * The consent line under everything.
   *
   * Not a link. The tappable Terms and Privacy Policy live in Settings, which
   * is where a store reviewer is told to find them; this is the notice at the
   * point of consent, and a sign-in screen is a bad place to send someone out
   * to a web page mid-flow. Set `text` to "" and the line disappears — it is a
   * value, not a node, so removing it needs no deploy.
   */
  legal: {
    text: "Continuing means you agree to our Terms and Privacy Policy.",
    fontSize: 10.5,
    lineHeight: 15,
    // Dim enough to read as fine print and no dimmer — this is the one line on
    // the screen that has to survive being looked at by a reviewer.
    color: "rgba(255,255,255,0.40)",
    marginTop: 24,
  },

  code: {
    // Kept as empty strings rather than deleted, so putting a line back is a
    // value rather than a node.
    title: "",
    sub: "",
    titleSize: 26,
    subSize: 14,
    gap: 10,
    blockGap: 30,
    /** The pill that replaced the six circles. */
    height: 56,
    letterSpacing: 8,
    fontSize: 17,
  },
};

/**
 * Build it. Returned inside BOOTSTRAP rather than from buildScreen, because the
 * auth gate runs before there is a session and can never fetch a screen — the
 * same reason the backdrop rides in the flags.
 *
 * AuthPhase gates the two halves. The phase lives in a React context in the
 * app, not in the SDUI store, so `visibleIf` has no state path to read; a node
 * is the honest way to express it rather than mirroring the phase into the
 * store and living with a frame where the two disagree.
 */
function authScreenTree(): Record<string, unknown> {
  const ui = AUTH_UI;
  // A STACK, NOT A SCREEN.
  //
  // Screen is a ScrollView that paints theme.color.bg and adds its own content
  // padding. Both are wrong here and both were visible: the paint covered the
  // uploaded backdrop entirely, and a scroll container does not honour
  // justifyContent unless its content is told to grow — so the rows sat under
  // the top padding instead of at the bottom. A plain filling stack has
  // neither problem.
  return {
    type: "Stack",
    style: {
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
      // Transparent, so the art behind is the background rather than being
      // hidden by one.
      backgroundColor: "transparent",
      justifyContent: "flex-end",
      paddingHorizontal: ui.paddingHorizontal,
      paddingTop: ui.paddingTop,
      paddingBottom: ui.paddingBottom,
    },
    children: [
      // ── entry ──────────────────────────────────────────────────────────
      {
        type: "AuthPhase",
        props: { phases: ["entry", "sending"] },
        children: [
          {
            type: "Stack",
            style: { gap: ui.entry.gap },
            children: [
              // Email is always offered. Phone draws nothing when the backend
              // has not enabled it, so the row simply is not there rather than
              // being there and failing when someone taps it.
              { type: "Rise",
                props: { ...ui.entry.suction.spring, scaleFrom: ui.entry.suction.scaleFrom, ...ui.entry.suction.rows.email },
                children: [{ type: "SwipePill", props: { method: "email", hintDelayMs: ui.entry.hintDelayMs, ...ui.pill } }] },
              { type: "Rise",
                props: { ...ui.entry.suction.spring, scaleFrom: ui.entry.suction.scaleFrom, ...ui.entry.suction.rows.phone },
                children: [{ type: "SwipePill", props: { method: "phone", hintDelayMs: ui.entry.hintDelayMs + ui.entry.hintStaggerMs, ...ui.pill } }] },
              { type: "Rise",
                props: { ...ui.entry.suction.spring, scaleFrom: ui.entry.suction.scaleFrom, ...ui.entry.suction.rows.socials },
                children: [{
                  type: "Stack",
                  style: {
                    direction: "row", gap: ui.entry.social.gap,
                    justifyContent: "center", marginTop: ui.entry.social.topGap,
                  },
                  children: [
                    { type: "AppleSignIn", props: { size: ui.entry.social.size } },
                    { type: "GoogleSignIn", props: { size: ui.entry.social.size } },
                  ],
                }] },
              // The consent notice, under everything. Inside the same Rise
              // sequence as the rows above it, because a static line appearing
              // instantly beneath five that fly in reads as a rendering fault.
              ...(ui.legal.text
                ? [{
                    type: "Rise",
                    props: {
                      ...ui.entry.suction.spring,
                      scaleFrom: ui.entry.suction.scaleFrom,
                      ...ui.entry.suction.rows.legal,
                    },
                    children: [{
                      type: "Text",
                      props: { content: ui.legal.text },
                      style: {
                        textAlign: "center",
                        fontSize: ui.legal.fontSize,
                        lineHeight: ui.legal.lineHeight,
                        color: ui.legal.color,
                        marginTop: ui.legal.marginTop,
                      },
                    }],
                  }]
                : []),
            ],
          },
        ],
      },

      // ── code ───────────────────────────────────────────────────────────
      {
        type: "AuthPhase",
        props: { phases: ["verify", "verifying"] },
        children: [
          {
            type: "Stack",
            style: { gap: ui.code.gap },
            children: [
              // No heading and no supporting line. The step is one field and one
              // way on, exactly like the screen before it.
              { type: "Rise",
                props: { ...ui.entry.suction.spring, scaleFrom: ui.entry.suction.scaleFrom, ...ui.entry.suction.rows.codePill },
                children: [{
                  type: "CodeEntry",
                  props: {
                    height: ui.code.height,
                    letterSpacing: ui.code.letterSpacing,
                    fontSize: ui.code.fontSize,
                  },
                }] },
            ],
          },
        ],
      },
    ],
  };
}

export const TRAINING_UI = {
  entry: {
    /** Tiny, tracked, uppercase — the line above the title. "" removes it. */
    kicker: "IT LEARNS YOU",
    kickerSize: 9.5,
    kickerTracking: 3,
    /**
     * BRIGHT WHITE, and it is the title that carries the brand instead.
     *
     * The usual arrangement — a dimmed kicker over a white headline — makes the
     * small line a caption on the big one. Swapping them makes the two lines a
     * pair: white states the claim, amber answers it, and the eye lands on the
     * amber because it is the only colour on the screen that is not the art.
     */
    kickerColor: "#FFFFFF",
    kickerGap: 16,

    /**
     * Two words, and they are the product.
     *
     * What is behind this button is a conversation — no prompts to answer, no
     * form, nothing to read. "Just talk." says the whole of that, and a screen
     * whose job is to be looked at rather than read cannot afford a sentence
     * anyway: every extra word competes with the art for the same attention.
     */
    title: "Just talk.",
    titleSize: 32,
    titleLineHeight: 38,
    /**
     * The brand amber, and NOT THEME.color.primary — primary is WHITE on this
     * black surface by design, so reaching for "the brand colour" through the
     * theme gets white and the change looks like it did nothing. The same trap
     * caught the Languages heading and the Stats tick.
     */
    titleColor: ACCENT_AMBER,
    /**
     * LIGHT SANS, NOT THE APP SERIF.
     *
     * Heading paints in the platform serif at regular weight, and at display
     * size that reads heavy and loud — it fills the frame and starts competing
     * with the image instead of sitting on it. A light sans at the same point
     * size occupies visibly less ink, which is why the reference can run its
     * title large and still feel quiet. Negative tracking because letter
     * spacing set for body text opens up too far at this size.
     */
    titleWeight: "300",
    titleTracking: -0.3,

    /**
     * WHERE THE COPY SITS, as a share of the run between the top of the window
     * and the button. The two flexes are a ratio, not a position: 1 above and
     * 0.85 below puts the block at 54% of that run on every screen size, which
     * a percentage or a fixed offset cannot promise.
     */
    spaceAbove: 1,
    spaceBelow: 0.85,

    paddingHorizontal: 26,
    /** Clears the status bar. The header is hidden, so this is the safe area. */
    paddingTop: 64,
    paddingBottom: 26,

    /**
     * HOW HARD THE ART IS BLURRED. 0 leaves it sharp.
     *
     * Same treatment as the You deck's cards, for the same reason and at the
     * same numbers. This screen carries two words and a pill; a sharp clip
     * behind them competes with both, and the eye keeps going back to the
     * moving detail instead of landing on "Just talk." Blurred, the art does
     * the job it is actually there for — colour, motion, mood — and stops
     * arguing with the copy.
     *
     * It also makes the slot forgiving. The art is uploaded, so it can be a
     * clip, a screenshot, a photograph or a frame with text burnt into it, and
     * the screen has to read the same either way.
     */
    mediaBlur: 26,
    mediaBlurTint: "dark" as const,
    /** Flat, over the blur, under the gradient. The blur softens the art; this
     *  is what guarantees a pale upload can never wash the title out. */
    mediaTint: "#000000",
    mediaTintOpacity: 0.34,

    /**
     * The scrim. Not a flat veil over the whole frame — that dulls the art
     * everywhere to fix legibility in one place. A vertical gradient leaves the
     * top as it was shot and darkens only where the words are.
     */
    scrim: ["rgba(0,0,0,0)", "rgba(0,0,0,0.28)", "rgba(0,0,0,0.72)"] as string[],
    /** Where each scrim colour sits, 0..1. Evenly spread reads wrong here: the
     *  art should stay clear for most of the height and fall away only where
     *  the words start. */
    scrimStops: [0, 0.55, 1] as number[],

    /**
     * The way in. A pill whose disc is DRAGGED to the far end — the sign-in
     * pills' gesture, so the product has one way of saying "commit this".
     */
    cta: {
      label: "BEGIN",
      background: "#0B0B0D",
      color: "#FFFFFF",
      fontSize: 12,
      tracking: 1.8,
      height: 58,
      radius: 999,
      /** The disc that travels. Starts on the LEFT. Plain — nothing drawn
       *  inside it; set `dot` above 0 to put a mark back. */
      disc: 46,
      discBackground: "rgba(255,255,255,0.14)",
      dot: 0,
      dotColor: "#FFFFFF",
      /** Where it lands. The one warm thing on the pill, so the end of the
       *  journey is visible from the start of it. Same dim amber as auth. */
      targetBackground: "#C9862B",
      targetDotColor: "#000000",
      /** How far along counts as committed, as a share of the run. */
      threshold: 0.62,
      /** When the disc nudges itself to advertise the drag. 0 removes the
       *  hint — and with it, most people's chance of finding the gesture. */
      hintDelayMs: 1250,
      /** Breathing room either side of the pill. */
      inset: 22,
    },
  },
  chat: {
    title: "Train",
    /** The first thing on the thread, before anyone has typed. */
    opener: "Someone cancels dinner an hour before. What do you write back?",
    variantsLabel: "Which sounds most like you?",
    refiningLabel: "Reading it…",
    placeholder: "Type your reply",
    send: "Send",
    /** Shown in place of the thread on a bundle too old to have ChatThread. */
    needsUpdate: "Update the app to see this conversation.",
    /** Every colour in the thread. The component defaults to these; passing
     *  them from here means a re-skin is a deploy rather than a bundle. */
    colors: {
      askBg: "rgba(255,255,255,0.06)",
      askBorder: "rgba(255,255,255,0.09)",
      askText: "rgba(255,255,255,0.9)",
      mineBg: "#FFFFFF",
      mineText: "#000000",
      noteText: ACCENT_AMBER,
      noteBg: "rgba(232,162,60,0.1)",
      noteBorder: "rgba(232,162,60,0.26)",
      variantBg: "rgba(255,255,255,0.05)",
      variantBorder: "rgba(255,255,255,0.1)",
      variantText: "rgba(255,255,255,0.92)",
      angleText: "rgba(255,255,255,0.4)",
      pickedBg: "rgba(232,162,60,0.13)",
      pickedBorder: ACCENT_AMBER,
      labelText: "rgba(255,255,255,0.38)",
      radius: 16,
      gap: 11,
    },
    live: {
      title: "Just talk",
      /** One word per session state. Caption, not the only signal — the
       *  bubble's motion says the same thing without being read. */
      status: {
        idle: "Ready",
        listening: "Listening",
        thinking: "Thinking",
        speaking: "Speaking",
        error: "Something went wrong",
      },
      hint: "Talk the way you normally would. Nothing here is graded.",
      end: "End & save",
      saving: "Reading the conversation",
      saved: "It knows you a little better.",
      /** The orb's canvas. The sphere is `orbRadius` of it, so the rest is the
       *  room the rim light falls off into — not padding. */
      bubble: 260,
      /** The major colour: band highlight, rim, and what the eye reads it as. */
      tint: ACCENT_AMBER,
      /**
       * The trough the bands fall into. An ember brown-red rather than a
       * neutral dark, because a warm object shaded with a cold shadow reads as
       * two materials rather than one.
       */
      orbDeep: "#4A1D08",
      /**
       * The pale top of the shimmer ramp — a LIGHT AMBER, not a cream.
       *
       * This was #FFDCA0, which is a peach: red and green nearly level with a
       * little blue under them. The shader ramps the shimmer from the deep to
       * this and then washes it over the bands, so the brightest part of the
       * orb — the part the eye names the colour by — was drifting off the
       * brand toward candlelight. Lightening the accent itself keeps the
       * highlight in the same family as the rim and the bands, so the whole
       * object reads as one colour lit, rather than an amber object with a
       * cream sheen on it.
       */
      orbGold: "#F8C879",
      /** Sphere radius as a share of the canvas. 0.32 is about 64% across. */
      orbRadius: 0.32,
      /**
       * 0 is bands alone; past ~0.45 the shimmer washes the bands out.
       *
       * Down from 0.28. The bands run deep → accent and are where the brand
       * colour actually lives; the shimmer is a wash over them. Less wash is
       * more amber, and with the ramp's top now amber too, 0.22 still reads as
       * a lit surface rather than a flat disc.
       */
      orbShimmer: 0.22,
      /**
       * How hard the rim brightens at full volume. Higher clips to white.
       *
       * Up from 0.75. The rim is the one part of the orb drawn in the accent
       * UNMIXED — `col += fres * accent * (0.35 + amp * rim)` — so it is the
       * cheapest brand in the whole object, and it only shows when the person
       * is actually speaking. 0.9 makes the edge flare amber on a loud word
       * and still stops short of the white it clips to.
       */
      orbRim: 0.9,
      /**
       * How far off the bottom the orb sits. The screen is the orb and nothing
       * else, so this is the only layout number on it.
       */
      orbBottom: 120,
      /** The way out, top left. Rounded tips — a chevron cut square reads as
       *  cropped rather than drawn. */
      backSize: 38,
      backTop: 56,
      backInset: 14,
      /** How far past its own edge the arrow still answers a touch. */
      backSlop: 16,
      backColor: "rgba(255,255,255,0.72)",
      backBackground: "rgba(255,255,255,0.08)",
      /** A pause this long, with something said, ends your turn. */
      silenceMs: 1500,
    },
    /** The background media slot. 0 hides it without removing the upload. */
    backgroundOpacity: 0.4,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
};

/**
 * The Training tab's front door: the art, one line, and the ways in.
 *
 * The refine loop did not shrink — it moved one tap deeper, to training_chat,
 * intact. What this screen buys is a place for the media and a choice that is
 * legible before anything is typed.
 */
function homeScreen(_ctx: ScreenContext): ScreenResponse {
  const ui = TRAINING_UI.entry;

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "home",
    title: "",
    // Header off, tabs on. The art runs to the top of the window — the header
    // sits IN FLOW, so its status-bar padding is space the art could never
    // reach — but this is a tab root, and hiding the tabs on the tab you are
    // standing on leaves no way off it.
    hideHeader: true,
    state: {},
    actions: {
      // WHERE THE SWIPE GOES, decided by a flag rather than by a deploy.
      //
      // The door this entry is meant to open is the spoken one — the orb, and
      // a real conversation. It is gated because the realtime voice behind it
      // is not finished, and an entry that opens an unfinished screen is worse
      // than one that opens a working older screen. So the flag chooses, and
      // turning it on is the whole change when the voice lands.
      //
      // The fallback is not a consolation: training_chat is the refine loop,
      // intact, one tap deeper than it used to be.
      enter: { kind: "sequence", actions: [
        { kind: "haptic", style: "light" },
        {
          kind: "condition",
          if: { flag: "train.realtime" },
          then: { kind: "navigate", screenId: "training_live" },
          else: { kind: "navigate", screenId: "training_chat" },
        },
      ] },
    },
    root: {
      type: "Stack",
      // Black under everything: what is seen before the art loads, and all
      // there is if nothing has been uploaded to the slot.
      style: { flex: 1, backgroundColor: "#000000" },
      children: [
        // The art, edge to edge. Upload to `training`; upload nothing and
        // screenHero returns no nodes and the screen is simply black.
        ...screenHero("training", { behind: true, fit: "cover" }),
        // Blurred and tinted, exactly as the You deck's cards are. Both layers
        // are driven from TRAINING_UI.entry, so the strength is a catalog edit
        // and never a build. Set mediaBlur to 0 to get the sharp art back.
        ...(ui.mediaBlur > 0 ? [{
          type: "BlurBackground",
          props: { intensity: ui.mediaBlur, tint: ui.mediaBlurTint },
          style: { ...FILL_STYLE },
        } as Node] : []),
        ...(ui.mediaTintOpacity > 0 ? [{
          type: "Stack",
          style: { ...FILL_STYLE, backgroundColor: ui.mediaTint,
                   opacity: ui.mediaTintOpacity },
        } as Node] : []),
        // The scrim over it, and under everything else.
        {
          type: "Gradient",
          props: { colors: ui.scrim, locations: ui.scrimStops, direction: "vertical" },
          style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
        },
        {
          type: "Stack",
          style: {
            flex: 1,
            paddingHorizontal: ui.paddingHorizontal,
            paddingTop: ui.paddingTop,
            paddingBottom: ui.paddingBottom,
          },
          children: [
            { type: "Stack", style: { flex: ui.spaceAbove } },
            ...(ui.kicker
              ? [{
                  type: "Text",
                  props: { content: ui.kicker },
                  style: {
                    textAlign: "center",
                    fontSize: ui.kickerSize,
                    letterSpacing: ui.kickerTracking,
                    color: ui.kickerColor,
                    marginBottom: ui.kickerGap,
                  },
                } as Node]
              : []),
            // Text, not Heading: Heading hardcodes the app's serif, and this
            // title is the one place that face is wrong for the job.
            {
              type: "Text",
              props: { content: ui.title },
              style: {
                textAlign: "center",
                fontSize: ui.titleSize,
                lineHeight: ui.titleLineHeight,
                fontWeight: ui.titleWeight,
                letterSpacing: ui.titleTracking,
                color: ui.titleColor,
              },
            },
            { type: "Stack", style: { flex: ui.spaceBelow } },
            // THE WAY IN, AND IT IS A DRAG.
            //
            // Behind this is a live microphone and a voice on the other end. A
            // tap is the cheapest gesture there is and it is over before
            // anyone has decided anything; a drag is a held intention, so
            // nobody opens a conversation by brushing the screen on the way
            // past. It is also the same gesture the sign-in pills use, which
            // is the point — one way of saying "commit this", everywhere.
            {
              type: "SwipeAction",
              props: {
                label: ui.cta.label,
                height: ui.cta.height,
                radius: ui.cta.radius,
                background: ui.cta.background,
                color: ui.cta.color,
                fontSize: ui.cta.fontSize,
                tracking: ui.cta.tracking,
                disc: ui.cta.disc,
                discBackground: ui.cta.discBackground,
                dot: ui.cta.dot,
                dotColor: ui.cta.dotColor,
                targetBackground: ui.cta.targetBackground,
                targetDotColor: ui.cta.targetDotColor,
                threshold: ui.cta.threshold,
                hintDelayMs: ui.cta.hintDelayMs,
              },
              on: { onComplete: "enter" },
              style: { marginHorizontal: ui.cta.inset },
              // A bundle without SwipeAction still has a way in.
              fallback: {
                type: "Button",
                props: { label: ui.cta.label, variant: "primary" },
                on: { onPress: "enter" },
                style: { marginHorizontal: ui.cta.inset, backgroundColor: ui.cta.background },
              },
            },
          ],
        },
        // The way into Settings — see settingsGear(). White, because this
        // root is the art and the art is dark.
        settingsGear("dark"),
      ],
    },
    cacheTtlSeconds: 300,
  };
}

function trainingChatScreen(ctx: ScreenContext): ScreenResponse {
  // In-app mic media. Prefer an MP4 upload (mic.animation.mp4) when present —
  // MediaPlayer's video branch freezes it on-frame while paused AND reacts its
  // speed to the mic level (voiceReactive), so the in-app mic feels alive and
  // pauses cleanly. Fall back to the GIF (mic.animation) otherwise; a GIF can't
  // pause on a frame, so freezeOnPause stays false and VoiceToggle swaps to the
  // static mark between takes. The keyboard keeps reading mic.animation (the
  // GIF) — an MP4 can't render in its image-based key button.
  const micReg = getMediaRegistryFn?.() ?? {};
  const micHasMp4 = !!micReg["mic.animation.mp4"]?.url;
  const micIdle = micHasMp4
    ? { source: { key: "mic.animation.mp4" }, autoplay: false, loop: true, muted: true, voiceReactive: true, freezeOnPause: true }
    : { source: { key: "mic.animation" }, autoplay: false, loop: true, voiceReactive: true };

  // Train picker: the user's WHOLE voice library (built-ins + their custom
  // tones), not a hardcoded tone list — tap any voice to train it. "Core
  // style" trains the tone-independent base portrait. Server-authored, so a
  // new custom voice appears here on the next screen fetch with no app update.
  const effective = applyPresetOverrides(ctx.personality.presetOverrides);
  const TONE_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
    { id: "none", label: "ZU", hint: "Your own way of talking — detected, cleaned, no vibe added" },
    ...effective.map((p) => ({
      id: p.id,
      label: p.name,
      hint: (p as { tagline?: string }).tagline ?? "Custom voice",
    })),
  ];
  // Seed the pill with the voice the user actually writes with, so "just tap
  // Refine" trains what they use daily.
  const activeVoice = effective.find(
    (e) => e.id === (ctx.personality.activePresetId ?? "signature"),
  );
  // A tappable voice row inside the blurred sheet: pick it → store the id +
  // its pill label, then close the sheet. All state, so the next Refine
  // trains in that voice.
  // The hint is GONE from the row. Thirteen voices each carrying a line of
  // description made the picker a wall of grey text you had to read through to
  // find a name — and the first row wrapped to two lines, so it did not even
  // read as a row. The list is names now; the description moved to the
  // long-press card, where there is room for it and for the prompt too.
  const toneRow = (opt: { id: string; label: string; hint: string }, i: number): Node => ({
    type: "Row",
    props: { label: opt.label, chevron: false, divider: i < TONE_OPTIONS.length - 1 },
    on: {
      onPress: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "setState", path: "tone", value: opt.id },
        { kind: "setState", path: "toneLabel", value: opt.label },
        { kind: "setState", path: "toneSheetOpen", value: false },
      ] },
      // Hold to look before you leap: what this voice is, and the prompt that
      // makes it that. Everything the card shows is pushed into state HERE, so
      // the card itself is one node bound to those values rather than thirteen
      // cards gated on an id.
      onLongPress: { kind: "sequence", actions: [
        { kind: "haptic", style: "medium" },
        { kind: "setState", path: "cardId", value: opt.id },
        { kind: "setState", path: "cardTitle", value: opt.label },
        { kind: "setState", path: "cardHint", value: opt.hint },
        { kind: "setState", path: "cardPrompt", value: tonePromptOf(opt.id) },
        { kind: "setState", path: "cardEditing", value: false },
        { kind: "setState", path: "toneSheetOpen", value: false },
        { kind: "setState", path: "cardOpen", value: true },
      ] },
    },
  });

  /** The prompt behind a voice — what actually shapes the writing. */
  function tonePromptOf(id: string): string {
    if (id === "none") {
      return "No voice is applied. Your words are cleaned up and left as yours.";
    }
    const p = effective.find((e) => e.id === id) as { promptStyle?: string } | undefined;
    return p?.promptStyle ?? "";
  }

  // The composer. It was a 96pt writing box with the mic parked inside it,
  // which is the right shape for a form and the wrong one for a chat: a field
  // that tall pushes the conversation off the screen before anyone has typed.
  // It grows with what you write instead, and stops before it eats the thread.
  const boxWithVoice = (bindKey: string): Node => ({
    type: "Stack", style: { position: "relative", flex: 1 }, children: [
      { type: "TextField", bind: { value: bindKey },
        props: { placeholder: TRAINING_UI.chat.placeholder, multiline: true },
        style: { paddingRight: 52, minHeight: 44, maxHeight: 120 } },
      { type: "Stack", style: { position: "absolute", right: 12, top: 0, bottom: 0, justify: "center" }, children: [
        {
          type: "VoiceToggle",
          bind: { value: bindKey },
          props: {
            targetApp: "WhatsApp",
            language: "auto",
            size: 38,
            background: "#E8A23C",
            iconIdle: micIdle,
          },
          // micError echoes the real failure ($event) — a permission denial or
          // an audio-session error must NOT look like a generic "check your
          // connection" toast, or it's undebuggable in the field.
          // onChange fires once the transcript has been written into the
          // field — that IS the moment to refine. Without it, speaking filled
          // the box and nothing else happened; the user had to know to tap
          // the card as well, and did not.
          on: { onChange: "send", onError: "micError" },
          // Older bundles don't have VoiceToggle in their registry. VoiceButton
          // has shipped since the initial SDUI release, drives the same bind,
          // and reads state → mic → transcript → writes back. Same product
          // outcome, one-tap-record instead of press-and-hold.
          fallback: {
            type: "VoiceButton",
            bind: { value: bindKey },
            props: { targetApp: "WhatsApp", language: "auto" },
            on: { onChange: "send", onError: "micError" },
          },
        },
      ] },
    ],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "training_chat",
    title: TRAINING_UI.chat.title,
    state: {
      input: "", recording: false, refining: false,
      // The conversation itself. Every row was appended by an action below, so
      // what the screen says is server-authored the same way its layout is.
      thread: [{ role: "ask", text: TRAINING_UI.chat.opener }],
      // Training target: which VOICE this session trains (and which the
      // variants speak in). "none" trains the core style. Seeded to the
      // user's active voice so a first send trains what they actually use.
      tone: activeVoice?.id ?? "none",
      toneLabel: activeVoice?.name ?? "ZU",
      toneSheetOpen: false,
      // Voice card (long-press). Seeded so the card's bound Texts render empty
      // rather than undefined before anything has been held.
      cardOpen: false,
      cardEditing: false,
      cardId: "",
      cardTitle: "",
      cardHint: "",
      cardPrompt: "",
      // ChatThread writes the tap into these; the pick action reads them.
      _train: null, _pick: null, _input: "", _chosen: "", _angle: "", _rejA: "", _rejB: "",
    },
    actions: {
      err: { kind: "toast", message: "Something went wrong. Check your connection.", tone: "error" },
      // Echoes the real reason ($event) the mic control failed — permission /
      // audio-session / transcribe failures each show their own cause.
      micError: { kind: "toast", message: "$event", tone: "error" },

      // Sending. The message lands on the thread and the field empties in the
      // same beat as the tap; the variants arrive when they arrive. Order
      // matters: _input is snapshotted BEFORE the field is cleared, because
      // the pick call sent a minute later still has to say what was asked.
      send: { kind: "sequence", actions: [
        { kind: "haptic", style: "light" },
        { kind: "setState", path: "_input", value: "$state.input" },
        { kind: "appendState", path: "thread", max: THREAD_MAX,
          value: { role: "mine", text: "$state.input" } },
        { kind: "setState", path: "input", value: "" },
        { kind: "setState", path: "refining", value: true },
        {
          kind: "callEndpoint",
          method: "POST",
          path: "/v1/train/variants",
          body: { text: "$state._input", tone: "$state.tone", language: "auto" },
          assignTo: "_train",
          onSuccess: "gotVariants",
          onError: "variantsErr",
        },
      ] },
      gotVariants: { kind: "sequence", actions: [
        { kind: "setState", path: "refining", value: false },
        { kind: "appendState", path: "thread", max: THREAD_MAX,
          value: {
            role: "variants",
            label: TRAINING_UI.chat.variantsLabel,
            options: "$state._train.variants",
          } },
        { kind: "haptic", style: "light" },
      ] },
      variantsErr: { kind: "sequence", actions: [
        { kind: "setState", path: "refining", value: false },
        { kind: "toast", message: "Couldn’t refine that. Check your connection and try again.", tone: "error" },
      ] },

      // The tap already happened — ChatThread highlighted the card and wrote
      // the choice into _chosen/_angle/_rejA/_rejB before firing this. All
      // that is left is telling the server, which is why nothing here is
      // optimistic: there is no UI waiting on it.
      picked: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        {
          kind: "callEndpoint",
          method: "POST",
          path: "/v1/train/pick",
          body: {
            input: "$state._input",
            chosen: "$state._chosen",
            rejectedA: "$state._rejA",
            rejectedB: "$state._rejB",
            tone: "$state.tone",
          },
          assignTo: "_pick",
          onSuccess: "learned",
          onError: "err",
        },
      ] },
      // What it took from the pick, then the next thing to answer. The prompt
      // comes back WITH the pick, so the list of them lives in one place on
      // the server and a conversation never runs out of things to ask.
      learned: { kind: "sequence", actions: [
        { kind: "appendState", path: "thread", max: THREAD_MAX,
          value: { role: "note", text: "$state._pick.learned" } },
        { kind: "appendState", path: "thread", max: THREAD_MAX,
          value: { role: "ask", text: "$state._pick.next" } },
      ] },

      // Saving from the voice card. The tone upsert makes the saved voice
      // ACTIVE, which is right — you edited it because you want to write with
      // it — so the picker's own state follows rather than silently disagreeing
      // with what the server now thinks the active voice is.
      cardSaved: { kind: "sequence", actions: [
        { kind: "setState", path: "cardEditing", value: false },
        { kind: "setState", path: "tone", value: "$state.cardId" },
        { kind: "setState", path: "toneLabel", value: "$state.cardTitle" },
        { kind: "setState", path: "cardOpen", value: false },
        { kind: "toast", message: "Voice saved.", tone: "success" },
      ] },
      cardSaveErr: { kind: "toast", message: "Couldn't save that voice. Try again.", tone: "error" },
    },
    root: {
      type: "Screen",
      // The THREAD scrolls, not the screen. A scrolling screen under a pinned
      // composer gives you two scrollers fighting over one gesture.
      props: { scroll: false },
      style: {
        paddingHorizontal: TRAINING_UI.chat.paddingHorizontal,
        paddingTop: TRAINING_UI.chat.paddingTop,
        flex: 1,
      },
      children: [
        // Background media slot — `hero.training_chat`. Same node and the same
        // present rules as the entry hero; what differs is that words sit on
        // top of it, so it is dimmed rather than veiled and the opacity is a
        // number in TRAINING_UI. An empty key renders nothing at all.
        ...screenHero("training_chat", {
          behind: true,
          fit: "cover",
          fullBleed: TRAINING_UI.chat.paddingHorizontal,
          fullBleedTop: TRAINING_UI.chat.paddingTop,
        }).map((n) => ({
          ...n,
          style: { ...(n.style ?? {}), opacity: TRAINING_UI.chat.backgroundOpacity },
        })),

        // Which voice this session trains. A chip at the top rather than the
        // old pill under the box: on a chat screen the only thing that belongs
        // at the bottom is the thing you type into.
        {
          type: "Stack",
          style: { direction: "row", alignItems: "center", gap: 10, marginBottom: 10 },
          children: [
            {
              type: "Button",
              bind: { label: "toneLabel" },
              props: { variant: "secondary" },
              style: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 18 },
              on: { onPress: { kind: "sequence", actions: [
                { kind: "haptic", style: "light" },
                { kind: "setState", path: "toneSheetOpen", value: true },
              ] } },
            },
            // Thinking. The brand media itself, playing only while the
            // variants generate — the same living mark the mic uses, kept at
            // caption size because on a chat screen the thing you are waiting
            // for is the message, not the spinner.
            {
              type: "Stack",
              visibleIf: { truthy: "refining" },
              style: { direction: "row", alignItems: "center", gap: 8 },
              children: [
                {
                  type: "Stack",
                  style: {
                    width: 22, height: 22, borderRadius: 11, overflow: "hidden",
                    backgroundColor: ACCENT_AMBER, alignItems: "center", justifyContent: "center",
                  },
                  children: [
                    // Static under-layer: the three-bar wave mark, so an old
                    // bundle with no Video still shows the brand and not a dot.
                    { type: "Stack", style: { direction: "row", gap: 1.5, alignItems: "center" }, children: [
                      { type: "Stack", style: { width: 1.5, height: 4, borderRadius: 1, backgroundColor: "#FFFFFF" } },
                      { type: "Stack", style: { width: 1.5, height: 8, borderRadius: 1, backgroundColor: "#FFFFFF" } },
                      { type: "Stack", style: { width: 1.5, height: 4, borderRadius: 1, backgroundColor: "#FFFFFF" } },
                    ] },
                    {
                      type: "Video",
                      bind: { playing: "refining" },
                      props: { source: micIdle, loop: true, muted: true, contentFit: "cover" },
                      style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
                      fallback: { type: "Spacer", style: { height: 0 } },
                    },
                  ],
                },
                { type: "Text", props: { content: TRAINING_UI.chat.refiningLabel },
                  style: { fontSize: 11.5, fontWeight: "600", color: "$color.muted", letterSpacing: 0.5 } },
              ],
            },
          ],
        },

        // The conversation. SDUI has no repeater, so this one node IS the
        // thread: it reads the array above and draws it, and owns the tap so a
        // pick never waits on the network to look chosen.
        {
          type: "ChatThread",
          bind: { thread: "thread" },
          props: {
            pickLabel: TRAINING_UI.chat.variantsLabel,
            chosenPath: "_chosen",
            anglePath: "_angle",
            rejectedAPath: "_rejA",
            rejectedBPath: "_rejB",
            colors: TRAINING_UI.chat.colors,
          },
          on: { onSelect: "picked" },
          style: { flex: 1 },
          // A bundle without ChatThread would render this screen's only content
          // as a hole. The field and the voice picker below still work, so the
          // honest fallback is a line saying where the conversation went.
          fallback: {
            type: "Text",
            props: { content: TRAINING_UI.chat.needsUpdate },
            style: { flex: 1, fontSize: 13.5, color: "$color.muted", textAlign: "center", paddingTop: 40 },
          },
        },

        // The composer, pinned. Type or speak — the mic writes into the same
        // field, so everything after the input is identical either way. Send
        // appears only once there is something to send.
        {
          type: "Stack",
          style: { direction: "row", alignItems: "flex-end", gap: 9, paddingTop: 10, paddingBottom: 6 },
          children: [
            boxWithVoice("input"),
            {
              type: "Button",
              props: { label: TRAINING_UI.chat.send, variant: "primary" },
              visibleIf: { truthy: "input" },
              style: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 22 },
              on: { onPress: "send" },
            },
          ],
        },

        // Blurred tone-picker sheet — pick which voice to train.
        {
          type: "Modal",
          bind: { open: "toneSheetOpen" },
          props: { blur: true, blurIntensity: 55, dismissable: true },
          children: [
            { type: "Text", props: { content: "Pick a voice to train" }, style: { fontSize: 18, fontWeight: "700", color: "#FFFFFF", textAlign: "center", marginBottom: 4 } },
            { type: "Text", props: { content: "Hold a voice to see what it does" },
              style: { fontSize: 12.5, color: "rgba(255,255,255,0.45)", textAlign: "center", marginBottom: 12 } },
            ...TONE_OPTIONS.map(toneRow),
          ],
        },


        // ---- Voice card: hold a voice, see what it is and what drives it ----
        //
        // One card bound to state, not one per voice: the row that opened it
        // pushed the title, description and prompt in, so this is a single node
        // however many voices exist.
        //
        // dismissable gives the tap-outside exit; the cross is here as well,
        // because a card the user cannot see the edge of is a card they cannot
        // tell is dismissable.
        {
          type: "Modal",
          bind: { open: "cardOpen" },
          props: { blur: true, blurIntensity: 70, dismissable: true },
          on: { onDismiss: { kind: "setState", path: "cardOpen", value: false } },
          children: [
            {
              type: "Stack",
              style: { direction: "row", alignItems: "center", gap: 10, marginBottom: 6 },
              children: [
                { type: "Text", bind: { content: "cardTitle" },
                  style: { flex: 1, fontSize: 22, fontWeight: "800", color: "#FFFFFF" } },
                {
                  type: "Button",
                  props: { label: "\u00d7", variant: "ghost" },
                  style: { paddingHorizontal: 10, paddingVertical: 2, fontSize: 26, color: "rgba(255,255,255,0.55)" },
                  on: { onPress: { kind: "setState", path: "cardOpen", value: false } },
                },
              ],
            },
            { type: "Text", bind: { content: "cardHint" },
              style: { fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.62)", marginBottom: 18 } },

            // READING. The prompt as it stands.
            { type: "Overline", props: { content: "Prompt" },
              visibleIf: { falsy: "cardEditing" },
              style: { color: "rgba(255,255,255,0.4)", marginBottom: 8 } },
            { type: "Text", bind: { content: "cardPrompt" },
              visibleIf: { falsy: "cardEditing" },
              style: { fontSize: 14, lineHeight: 22, color: "rgba(255,255,255,0.82)", marginBottom: 20 } },
            {
              type: "Button",
              props: { label: "Edit", variant: "secondary" },
              visibleIf: { falsy: "cardEditing" },
              style: { width: "100%" },
              on: { onPress: { kind: "sequence", actions: [
                { kind: "haptic", style: "selection" },
                { kind: "setState", path: "cardEditing", value: true },
              ] } },
            },

            // EDITING. Same card, same place — the prompt becomes writable
            // rather than the user being pushed to another screen and losing
            // the voice they were looking at.
            { type: "Overline", props: { content: "Prompt" },
              visibleIf: { truthy: "cardEditing" },
              style: { color: "rgba(255,255,255,0.4)", marginBottom: 8 } },
            {
              type: "TextField",
              bind: { value: "cardPrompt" },
              visibleIf: { truthy: "cardEditing" },
              props: { placeholder: "How this voice should write…", multiline: true },
              style: { minHeight: 132, marginBottom: 14 },
            },
            {
              type: "Stack",
              visibleIf: { truthy: "cardEditing" },
              style: { direction: "row", gap: 10 },
              children: [
                {
                  type: "Button",
                  props: { label: "Cancel", variant: "secondary" },
                  style: { flex: 1 },
                  on: { onPress: { kind: "setState", path: "cardEditing", value: false } },
                },
                {
                  type: "Button",
                  props: { label: "Save", variant: "primary" },
                  style: { flex: 1 },
                  on: { onPress: { kind: "sequence", actions: [
                    { kind: "haptic", style: "selection" },
                    {
                      kind: "callEndpoint",
                      method: "POST",
                      path: "/v1/personality/tone",
                      body: { id: "$state.cardId", name: "$state.cardTitle", promptStyle: "$state.cardPrompt" },
                      onSuccess: "cardSaved",
                      onError: "cardSaveErr",
                    },
                  ] } },
                },
              ],
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 180,
  };
}

/**
 * The realtime door: a spoken conversation, and a portrait read from it.
 *
 * Three nodes do the work and none of them is native. VoiceSession owns the
 * audio loop and writes `sessionState`, `level`, `line` and `turns` into this
 * screen's state; VoiceBubble draws from the first two; the End button posts
 * the fourth. Everything else here is ordinary layout, so where the bubble
 * sits, what the states are called and how long a pause ends a turn are all
 * edits to TRAINING_UI.
 *
 * It is turn-based, not full duplex — you cannot interrupt it. That needs a
 * bidirectional audio session and a native module the app does not carry, so
 * it is honestly absent rather than half-built. The pieces this DOES use
 * (the streaming mic, speech synthesis, Skia) all shipped long ago, which is
 * why the whole screen arrives without a build.
 */
function trainingLiveScreen(): ScreenResponse {
  const ui = TRAINING_UI.chat.live;

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "training_live",
    title: ui.title,
    state: {
      sessionState: "idle",
      level: 0,
      // NOT seeded. The line below carries the hint as its literal content and
      // binds `line` over it, so leaving this unset is what makes the hint the
      // opening state — seeded as "", the bind won with an empty string and the
      // hint never appeared at all.
      turns: [],
      saving: false,
      saved: false,
      /** Set by the back arrow, so onDisappear does not post a second time. */
      leaving: false,
    },
    actions: {
      sessionErr: { kind: "toast", message: "$event", tone: "error" },
      // The conversation is read ONCE, here, on the way out. Per-turn updates
      // would let a single throwaway line move the portrait as far as the
      // pattern does.
      /**
       * LEAVING IS SAVING. There is no End button any more — the screen is the
       * orb and nothing else — so the way out has to carry the save.
       *
       * `leaving` is the guard. The back arrow runs this, which marks the flag
       * before it posts; the root's onDisappear runs the same post ONLY if the
       * flag is unset, which is the case when someone swipes back or is taken
       * off the screen some other way. So the conversation is read exactly
       * once however it ends, and never twice.
       */
      finish: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "setState", path: "leaving", value: true },
        { kind: "setState", path: "saving", value: true },
        {
          kind: "callEndpoint",
          method: "POST",
          path: "/v1/train/portrait",
          body: { turns: "$state.turns" },
          onSuccess: "saved",
          onError: "saveErr",
        },
      ] },
      /** The other way out. Fires on unmount, and does nothing if the arrow
       *  already handled it. */
      saveIfUnhandled: {
        kind: "condition",
        if: { falsy: "leaving" },
        then: {
          kind: "callEndpoint",
          method: "POST",
          path: "/v1/train/portrait",
          body: { turns: "$state.turns" },
        },
      },
      saved: { kind: "sequence", actions: [
        { kind: "setState", path: "saving", value: false },
        { kind: "setState", path: "saved", value: true },
        { kind: "toast", message: ui.saved, tone: "success" },
        { kind: "navigate", screenId: "home" },
      ] },
      // A failed save must not trap someone on this screen. They leave either
      // way; what they lose is the portrait update, and the toast says so.
      saveErr: { kind: "sequence", actions: [
        { kind: "setState", path: "saving", value: false },
        { kind: "toast", message: "Couldn't save that conversation.", tone: "error" },
        { kind: "navigate", screenId: "home" },
      ] },
    },
    // The header carried the screen's name, and the name was a second copy of
    // the words on the button that opened it. Gone, so the way out is drawn
    // here instead — see the arrow below.
    hideHeader: true,
    root: {
      type: "Stack",
      // The save happens here for anyone who leaves without using the arrow.
      on: { onDisappear: "saveIfUnhandled" },
      style: { flex: 1, backgroundColor: "#000000", justifyContent: "flex-end", alignItems: "center" },
      children: [
        // Draws nothing. Mounting it starts the conversation; leaving the
        // screen unmounts it, which is what stops the mic.
        {
          type: "VoiceSession",
          props: {
            path: "/v1/train/converse",
            silenceMs: ui.silenceMs,
            statePath: "sessionState",
            levelPath: "level",
            linePath: "line",
            turnsPath: "turns",
          },
          on: { onError: "sessionErr" },
        },

        // EVERYTHING THAT IS NOT THE ORB IS THE WAY OUT.
        //
        // The arrow is a 38pt target in the corner and a thumb is wider than
        // that, so leaving was the one thing on this screen that took aim. It
        // does not have to: the screen holds a single object and the rest is
        // ground, and ground that dismisses is a gesture people already have
        // from every sheet they have ever closed.
        //
        // Placed BEFORE the orb and after everything else, which is what makes
        // it "outside the orb" rather than "anywhere": the topmost view under
        // a finger is the one that answers, so the orb keeps its own area and
        // the arrow, drawn last, keeps its own. This layer gets the rest.
        //
        // It fires `finish`, not a bare navigate — leaving by tapping the black
        // is still leaving, and the conversation is saved exactly as the arrow
        // saves it.
        {
          type: "Stack",
          on: { onPress: "finish" },
          props: { pressOpacity: 1 },
          style: { ...FILL_STYLE },
        },

        // THE ONLY THING ON THE SCREEN.
        //
        // No status word, no transcript line, no button. A conversation is
        // something you have, not something you read, and every one of those
        // was the screen explaining itself while the user was mid-sentence.
        // What the orb is doing says which state it is in, which is the whole
        // reason it moves.
        {
          type: "AuroraOrb",
          bind: { level: "level", state: "sessionState" },
          props: {
            size: ui.bubble,
            tint: ui.tint,
            deep: ui.orbDeep,
            gold: ui.orbGold,
            radius: ui.orbRadius,
            shimmer: ui.orbShimmer,
            rim: ui.orbRim,
          },
          // Older bundles fall back to the orb they already have, and older
          // ones still to the wave mark. Both are worse than this and far
          // better than a hole where the only visual is.
          fallback: {
            type: "VoiceBubble",
            bind: { level: "level", state: "sessionState" },
            props: { size: ui.bubble, tint: ui.tint },
            fallback: {
              type: "Waveform",
              bind: { level: "level" },
              style: { width: ui.bubble * 0.62, height: ui.bubble * 0.42 },
            },
          },
          style: { marginBottom: ui.orbBottom },
        },

        // THE WAY OUT, and the only control left. Last in the list so it paints
        // over everything, and absolute so the orb's own placement ignores it.
        {
          type: "Stack",
          on: { onPress: "finish" },
          // The disc is 38pt and a thumb is about 44. The slop is the
          // difference, taken outward, so the target is a thumb's width while
          // the thing drawn stays the size it should be.
          props: { pressOpacity: 0.6, hitSlop: ui.backSlop },
          style: {
            position: "absolute", top: ui.backTop, left: ui.backInset,
            width: ui.backSize, height: ui.backSize, borderRadius: ui.backSize / 2,
            alignItems: "center", justifyContent: "center",
            backgroundColor: ui.backBackground,
          },
          children: [{
            type: "SVG",
            props: {
              viewBox: "0 0 24 24", d: "M14.5 5 L8 12 L14.5 19",
              fill: "none", stroke: ui.backColor, strokeWidth: 2.2,
              strokeLinecap: "round", strokeLinejoin: "round",
            },
            style: { width: 16, height: 16 },
          }],
        },
      ],
    },
    // Never cached: this screen's whole content is the conversation it is
    // having, and a cached copy of that is a copy of someone else's.
    cacheTtlSeconds: 0,
  };
}

/**
 * The "You" tab — two large media-background cards with a gap between them.
 * Tapping "Voice" opens the tone list; tapping "Dictionary" opens the word
 * editor. Each card's art is uploaded under the `card.voice` / `card.dictionary`
 * media keys (swap OTA). The "Hello, name + gender" profile card overlays this
 * screen on first visit (profileGate.screenIds = ["personality"]).
 */
/**
 * THE YOU TAB — a deck of cards turned in depth, and the four screens behind it.
 *
 * TWO COLOURS, THE OTHER WAY ROUND. The Stats screen is an amber ground with
 * black cards on it. These are the reverse: a black ground with the brand
 * block on top. Same two colours, same discipline about using nothing else —
 * so the two tabs read as one system seen from either side, and neither needs
 * a third colour to say which is which.
 *
 * Everything here is a value. Card size, how far the deck turns, how hard the
 * backdrop is blurred, the strength of every scrim, the size and tracking of
 * every piece of type: all of it sits in YOU_UI and none of it is compiled
 * into the app. Changing how this tab looks is changing this object.
 */
export const YOU_UI = {
  ground: "#0B0B0D",
  accent: ACCENT_AMBER,
  /** Ink ON the amber block — the ground and the ink swap roles up there. */
  onAccent: "#0B0B0D",
  onAccentDim: "rgba(11,11,13,0.58)",
  /** Type on the black ground. */
  text: "#FFFFFF",
  textDim: "rgba(255,255,255,0.56)",
  textFaint: "rgba(255,255,255,0.30)",
  rule: "rgba(255,255,255,0.07)",
  padding: 18,
  /**
   * A pill — the one repeated object on all four inside screens. A voice, a
   * language, a saved word and a keyboard all arrive as the same shape, so
   * the four screens are learnt once rather than four times.
   */
  pill: {
    background: "#141418",
    radius: 999,
    paddingLeft: 16,
    paddingRight: 7,
    paddingVertical: 7,
    minHeight: 44,
    gap: 8,
    labelSize: 14.5,
    subSize: 11.5,
    marginBottom: 7,
  },
  /** A small action on a pill — Edit, Add, Remove, Save. */
  chip: {
    height: 28,
    radius: 999,
    paddingHorizontal: 13,
    fontSize: 10,
    tracking: 0.7,
    /** The quiet form: brand type on a brand wash. */
    soft: "rgba(232,162,60,0.13)",
  },
  /** The amber block every inside screen opens with. */
  head: {
    paddingTop: 56,
    paddingBottom: 18,
    radius: 0,
    kickerSize: 8.5,
    kickerTracking: 2.4,
    titleSize: 28,
    titleTracking: -1,
    controlSize: 32,
    /**
     * How far past its own edge a head control still answers a touch.
     *
     * 32 is the size the block wants — a bigger disc on that amber bar reads
     * as a button stuck onto it rather than as part of it — and 32 is under
     * what a thumb reliably hits. The slop is the difference, so the control
     * stays the size it looks right at and is the size a hand needs.
     */
    controlSlop: 11,
    gap: 14,
  },
  /** A section label on the black ground. */
  label: { size: 8.5, tracking: 2.2, marginTop: 22, marginBottom: 9 },
  /** The deck on the tab root. */
  deck: {
    cardWidth: 198,
    cardHeight: 198,
    radius: 20,
    step: 142,
    rotation: 42,
    depth: 150,
    perspective: 800,
    shrink: 0.07,
    fade: 0.36,
    stiffness: 150,
    damping: 19,
    mass: 0.9,
    throwFactor: 0.9,
    /**
     * How hard each CARD's own art is blurred. 0 leaves it sharp.
     *
     * Softer than the backdrop's: the backdrop is blurred past reading because
     * it is a wash, and a card still has to look like a place.
     */
    cardBlur: 26,
    cardBlurTint: "dark" as const,
    /** Over each card's own art, so an uploaded photo can never eat the title. */
    scrim: "#000000",
    scrimOpacity: 0.34,
    titleSize: 15,
    titleTracking: -0.2,
    /** The middle card's art again, behind everything. */
    backdropBlur: 70,
    backdropTint: "dark" as const,
    backdropWash: "#0B0B0D",
    backdropWashOpacity: 0.46,
    /** The key the deck's last position is stored under. "" forgets. */
    memory: "you.deck",
    /** A tap on a side card centres it; a tap on the centred card opens it.
     *  false makes any tap open, which is what this did before. */
    tapToCentre: true,
  },
  /**
   * The greeting, top left — "hello" over the person's name.
   *
   * It sits opposite the settings gear and on its line, so the top of the
   * screen reads as one row: who this is on the left, the way out on the
   * right. The hello starts in English and turns over into another language,
   * and keeps going. The name never moves — the greeting changes language,
   * the person does not.
   *
   * Defined up with the type scale, because its two lines are part of it. One
   * block owns the whole greeting: position, cadence, both type sets and both
   * colours, each settable alone.
   */
  greet: GREET,
  /**
   * The note under the deck — what the card in the middle actually is.
   *
   * A deck of four words is a beautiful way to show four things and a poor
   * way to say what any of them are. "Dictionary" is a label, not an
   * explanation, and the card it sits on is a picture. So the middle card
   * gets a line of plain speech beneath it and a second way in.
   *
   * THE BRAND BLOCK, not another dark card. The deck is glass over blurred
   * art and everything on this tab is either that or black; a solid amber
   * rectangle with black ink is the one shape here that cannot be mistaken
   * for scenery, which is what a thing you are meant to read has to be. It is
   * the same block the four inside screens open with, so arriving on one is
   * the box growing to fill the screen rather than a new colour appearing.
   */
  info: {
    background: ACCENT_AMBER,
    /** Ink on the amber. Black, and mid-weight — not bold, which on a solid
     *  colour reads as shouting rather than as speech. */
    text: "#0B0B0D",
    // A SHORT LINE CAN BE SMALLER. Nine words at 13 read as fast as fifteen
    // at 13.5 and leave the chart the room it now takes.
    textSize: 13,
    textWeight: "600",
    textLineHeight: 18,
    radius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    /** Air between the deck and the box, and between the box and the tabs. */
    marginTop: 6,
    marginBottom: 14,
    marginHorizontal: 18,
    /**
     * The chart in the note.
     *
     * SOLID, NOT A RING. A ring's hole exists to hold a number, and there is
     * no number here — so a hole would be a hole. thickness === size / 2
     * fills it to the centre, which is also what reads at this size: at 46pt
     * a thin arc is a hairline, a wedge is a shape.
     *
     * Sized to be READ ACROSS THE ROOM, not squinted at. At 46 the shape was
     * there and you had to look for it; at 58 you see which way it leans
     * without meaning to, which is the whole job of a chart in a caption. The
     * sentence beside it got shorter in the same change, so the strip did not
     * grow to pay for it.
     */
    chart: { size: 58, thickness: 29, gap: 2 },
    /** The way in, on the amber: black pill, amber ink. */
    cta: {
      height: 32,
      radius: 999,
      paddingHorizontal: 15,
      fontSize: 11,
      tracking: 0.6,
      background: "#0B0B0D",
      text: ACCENT_AMBER,
    },
  },
};

/**
 * Zu on the keyboard — the whole tone row until the user makes it theirs.
 *
 * Zu is not a style among the others: it is the app writing as this person,
 * from what it has learned of them. So a keyboard that opens with one chip
 * saying Zu is making a smaller and truer claim than one offering a menu of
 * moods nobody asked for — there is nothing to choose between yet, because
 * the only voice so far is the user's own.
 *
 * Read off the preset rather than restated, so the name has one home.
 */
const HOUSE_TONE = (() => {
  const base = PERSONALITY_PRESETS.find((p) => p.id === "signature") ?? PERSONALITY_PRESETS[0]!;
  return { id: base.id, name: base.name, tone: base.defaultTone };
})();

/**
 * "Hello", around the world — the one cycle, the same for everyone.
 *
 * THE ORDER IS THE DESIGN, which is why this is a list and not a map. The
 * greeting turns over in place, so two words in the same script one after the
 * other read as a typo rather than a change of language. Every step here moves
 * to a different writing system where it can — Latin, then Devanagari, then
 * Latin, then Han — so each turn is visibly a turn.
 *
 * English is first because it is the word on screen when the tab opens.
 * Nothing after it depends on the account: one person's phone shows the same
 * sequence as the next one's.
 *
 * The code beside each word is documentation, not a lookup. It says which
 * language the word belongs to so the next person to edit this list can check
 * one without guessing from the script.
 */
const HELLOS: Array<[code: string, hello: string]> = [
  ["en", "Hello"],
  ["hi", "\u0928\u092e\u0938\u094d\u0924\u0947"],
  ["es", "Hola"],
  ["zh", "\u4f60\u597d"],
  ["fr", "Bonjour"],
  ["ar", "\u0645\u0631\u062d\u0628\u0627"],
  ["ja", "\u3053\u3093\u306b\u3061\u306f"],
  ["pt", "Ol\u00e1"],
  ["ru", "\u041f\u0440\u0438\u0432\u0435\u0442"],
  ["ta", "\u0bb5\u0ba3\u0b95\u0bcd\u0b95\u0bae\u0bcd"],
  ["it", "Ciao"],
  ["ko", "\uc548\ub155\ud558\uc138\uc694"],
  ["de", "Hallo"],
  ["bn", "\u09a8\u09ae\u09b8\u09cd\u0995\u09be\u09b0"],
  ["tr", "Merhaba"],
  ["he", "\u05e9\u05dc\u05d5\u05dd"],
  ["te", "\u0c28\u0c2e\u0c38\u0c4d\u0c15\u0c3e\u0c30\u0c02"],
  ["pl", "Cze\u015b\u0107"],
  ["th", "\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35"],
  ["gu", "\u0aa8\u0aae\u0ab8\u0acd\u0aa4\u0ac7"],
  ["el", "\u0393\u03b5\u03b9\u03b1 \u03c3\u03b1\u03c2"],
  ["vi", "Xin ch\u00e0o"],
  ["kn", "\u0ca8\u0cae\u0cb8\u0ccd\u0c95\u0cbe\u0cb0"],
  ["fa", "\u0633\u0644\u0627\u0645"],
  ["sv", "Hej"],
  ["ml", "\u0d28\u0d2e\u0d38\u0d4d\u0d15\u0d3e\u0d30\u0d02"],
  ["uk", "\u041f\u0440\u0438\u0432\u0456\u0442"],
  ["pa", "\u0a38\u0a24 \u0a38\u0a4d\u0a30\u0a40 \u0a05\u0a15\u0a3e\u0a32"],
  ["id", "Halo"],
  ["or", "\u0b28\u0b2e\u0b38\u0b4d\u0b15\u0b3e\u0b30"],
  ["tl", "Kumusta"],
  ["ur", "\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u06cc\u06a9\u0645"],
  ["cs", "Ahoj"],
  ["my", "\u1019\u1004\u103a\u1039\u1002\u101c\u102c\u1015\u102b"],
  ["sw", "Habari"],
  ["mr", "\u0928\u092e\u0938\u094d\u0915\u093e\u0930"],
  ["hu", "Szia"],
  ["ka", "\u10d2\u10d0\u10db\u10d0\u10e0\u10ef\u10dd\u10d1\u10d0"],
  ["zu", "Sawubona"],
  ["si", "\u0d86\u0dba\u0dd4\u0db6\u0ddd\u0dc0\u0db1\u0dca"],
  ["ro", "Salut"],
  ["am", "\u1230\u120b\u121d"],
  ["no", "Hei"],
  ["km", "\u179f\u17bd\u179f\u17d2\u178f\u17b8"],
  ["hy", "\u0532\u0561\u0580\u0587"],
  ["fi", "Moi"],
  ["yo", "Bawo"],
  ["nl", "Hoi"],
  ["ha", "Sannu"],
];

/**
 * The cycle, built once.
 *
 * The dedup is a guard on the list above, not a feature: two languages can
 * genuinely share a word, and the same word twice running reads as a skipped
 * turn rather than a greeting in another language.
 */
function helloCycle(): string[] {
  const seen = new Set<string>();
  return HELLOS
    .map(([, hello]) => hello)
    .filter((w) => (seen.has(w) ? false : (seen.add(w), true)));
}

/**
 * THE CHARTS — one place that turns measured stats into slices.
 *
 * Every number here came off the user's own history. Nothing is smoothed,
 * padded or invented: a card with no data returns no slices and the ring says
 * so in words, because an empty ring is the truthful picture of "you have not
 * done this yet" and a full one of a single grey slice is not.
 *
 * COLOURS ARE PER SURFACE, and that is why they are arguments rather than
 * constants. The You cards sit on solid amber and the Stats cards on black,
 * so the same slice needs near-black ink on one and amber on the other. Both
 * palettes are one hue at falling weight rather than a spectrum — a chart of
 * five unrelated colours invites the reader to look for meaning in the hue,
 * and here the only meaning is size.
 */
type Slice = { label: string; value: number; color: string };

/** Ink on the amber block: black at falling weight. */
const CHART_ON_AMBER = [
  "#0B0B0D", "rgba(11,11,13,0.72)", "rgba(11,11,13,0.50)",
  "rgba(11,11,13,0.32)", "rgba(11,11,13,0.18)",
];
/** On the black ground: the brand amber at falling weight. */
const CHART_ON_DARK = [
  ACCENT_AMBER, "rgba(232,162,60,0.72)", "rgba(232,162,60,0.50)",
  "rgba(232,162,60,0.32)", "rgba(255,255,255,0.16)",
];

/** Language codes as people read them. Anything unlisted shows its own code. */
const LANGUAGE_NAMES: Record<string, string> = {
  auto: "Auto", en: "English", hi: "Hindi", hinglish: "Hinglish", mr: "Marathi",
  bn: "Bengali", ta: "Tamil", te: "Telugu", gu: "Gujarati", kn: "Kannada",
  ml: "Malayalam", pa: "Punjabi", ur: "Urdu", es: "Spanish", fr: "French",
  de: "German", it: "Italian", pt: "Portuguese", ru: "Russian", ar: "Arabic",
  ja: "Japanese", ko: "Korean", zh: "Chinese",
};

/**
 * Top N slices, with the tail folded into one.
 *
 * Five is the ceiling because a ring is read by comparing arcs, and past five
 * the arcs are too close to tell apart — the sixth-largest thing is better
 * served by the word "Other" than by a slice nobody can measure.
 */
function topSlices(
  rows: Array<{ label: string; words: number }>,
  palette: string[],
  tailLabel = "Other",
): Slice[] {
  const ranked = [...rows].filter((r) => r.words > 0).sort((a, b) => b.words - a.words);
  const head = ranked.slice(0, palette.length - 1);
  const tail = ranked.slice(palette.length - 1).reduce((sum, r) => sum + r.words, 0);
  const out: Slice[] = head.map((r, i) => ({
    label: r.label, value: r.words, color: palette[i]!,
  }));
  if (tail > 0) out.push({ label: tailLabel, value: tail, color: palette[palette.length - 1]! });
  return out;
}

/** What share of the saved dictionary is doing any work. */
function dictionarySlices(stats: StatsResponse | undefined, palette: string[]): Slice[] {
  const d = stats?.dictionary;
  if (!d || d.saved <= 0) return [];
  return [
    { label: "Used", value: d.used, color: palette[0]! },
    { label: "Never used", value: d.unused, color: palette[palette.length - 1]! },
  ].filter((sl) => sl.value > 0);
}

/** Which voice actually writes. Ids resolve to the names the user sees. */
function voiceSlices(
  stats: StatsResponse | undefined,
  personality: Personality | undefined,
  palette: string[],
): Slice[] {
  const rows = stats?.voiceWords ?? [];
  if (!rows.length) return [];
  const named = applyPresetOverrides(personality?.presetOverrides);
  return topSlices(
    rows.map((r) => ({
      label: named.find((p) => p.id === r.id)?.name ?? r.id,
      words: r.words,
    })),
    palette,
  );
}

/** What they write in. */
function languageSlices(stats: StatsResponse | undefined, palette: string[]): Slice[] {
  const rows = stats?.languageWords ?? [];
  if (!rows.length) return [];
  return topSlices(
    rows.map((r) => ({ label: LANGUAGE_NAMES[r.language] ?? r.language, words: r.words })),
    palette,
  );
}

/**
 * The ring, as a node.
 *
 * `centerValue` is the one number worth reading without the legend — the share
 * of the dictionary in use, the count of languages written in. It is computed
 * here from the same rows the slices come from, so the hole can never disagree
 * with the ring around it.
 */
function pieNode(opts: {
  slices: Slice[];
  size: number;
  thickness?: number;
  gap?: number;
  legend?: boolean;
  legendColor?: string;
  centerValue?: string;
  centerLabel?: string;
  emptyLabel: string;
  style?: Record<string, unknown>;
}): Node {
  return {
    type: "PieChart",
    props: {
      slices: opts.slices,
      size: opts.size,
      thickness: opts.thickness ?? Math.round(opts.size * 0.17),
      ...(opts.gap !== undefined ? { gap: opts.gap } : {}),
      legend: opts.legend ?? false,
      ...(opts.legendColor ? { legendColor: opts.legendColor } : {}),
      ...(opts.centerValue ? { centerValue: opts.centerValue } : {}),
      ...(opts.centerLabel ? { centerLabel: opts.centerLabel } : {}),
      emptyLabel: opts.emptyLabel,
    },
    ...(opts.style ? { style: opts.style } : {}),
  };
}

/**
 * The deck, in order. One list feeds the cards, the backdrops AND the routing,
 * so a fifth card is one entry here and nothing else — there is no second
 * place that has to be told the deck grew.
 */
const YOU_CARDS: {
  title: string;
  media: string;
  screen: string;
  /** The line under the deck when this card is the one in the middle. One
   *  sentence, plain, about what the thing IS — the title is already the
   *  label and a second label helps nobody. */
  blurb: string;
  /** The button on that line. Names the destination, so the deck's own tap
   *  and this one visibly go to the same place. */
  cta: string;
  /**
   * The small chart beside the words, built from this user's own history.
   *
   * A function of the context rather than a value, because it is measured per
   * request. Cards with nothing to measure — Haptics is a preference, not a
   * behaviour — simply have none, and the box is words and a button as before.
   *
   * Slices only. What each one is worth, what share it takes and what it is
   * called are questions for Stats; here the chart is a shape.
   */
  chart?: (ctx: ScreenContext) => Slice[];
}[] = [
  {
    title: "Voice", media: "card.voice", screen: "voices",
    blurb: "Zu writes as you. Add a voice for when it shouldn't.",
    cta: "Voices",
    chart: (ctx) => voiceSlices(ctx.stats, ctx.personality, CHART_ON_AMBER),
  },
  {
    title: "Dictionary", media: "card.dictionary", screen: "dictionary",
    blurb: "Your words, spelled your way. Never corrected.",
    cta: "Words",
    chart: (ctx) => dictionarySlices(ctx.stats, CHART_ON_AMBER),
  },
  {
    title: "Haptics", media: "card.haptics", screen: "haptics",
    blurb: "How it feels under your thumb.",
    cta: "Feel",
    // No ring. Haptics is a preference, not a behaviour — there is nothing
    // measured here, and a chart of a setting is decoration.
  },
  {
    title: "Languages", media: "card.languages", screen: "languages",
    blurb: "Pick a language. It listens for it.",
    cta: "Languages",
    chart: (ctx) => languageSlices(ctx.stats, CHART_ON_AMBER),
  },
];

/** The way back, on the amber. A chevron with rounded tips, not a cropped one. */
function youBack(): Node {
  const u = YOU_UI;
  return {
    type: "Stack",
    on: {
      onPress: {
        kind: "sequence",
        actions: [{ kind: "haptic", style: "selection" }, { kind: "navigateBack" }],
      },
    },
    props: { pressOpacity: 0.55, hitSlop: u.head.controlSlop },
    style: {
      width: u.head.controlSize, height: u.head.controlSize,
      borderRadius: u.head.controlSize / 2,
      alignItems: "center", justifyContent: "center",
      backgroundColor: "rgba(11,11,13,0.09)",
    },
    children: [{
      type: "SVG",
      props: {
        viewBox: "0 0 24 24", d: "M14.5 5 L8 12 L14.5 19",
        fill: "none", stroke: u.onAccent, strokeWidth: 2.3,
        strokeLinecap: "round", strokeLinejoin: "round",
      },
      style: { width: 14, height: 14 },
    }],
  };
}

/** A round control on the amber block — the ＋ at the top right of Voice. */
function youHeadIcon(d: string, onPress: ActionRef): Node {
  const u = YOU_UI;
  return {
    type: "Stack",
    on: { onPress },
    props: { pressOpacity: 0.55, hitSlop: u.head.controlSlop },
    style: {
      width: u.head.controlSize, height: u.head.controlSize,
      borderRadius: u.head.controlSize / 2,
      alignItems: "center", justifyContent: "center",
      backgroundColor: "rgba(11,11,13,0.09)",
    },
    children: [{
      type: "SVG",
      props: {
        viewBox: "0 0 24 24", d,
        fill: "none", stroke: u.onAccent, strokeWidth: 2.3,
        strokeLinecap: "round", strokeLinejoin: "round",
      },
      style: { width: 15, height: 15 },
    }],
  };
}

/**
 * The amber block. Every inside screen opens with one, which is what makes the
 * four of them one place — and it carries the back control, because these
 * screens hide the app's own header to get the colour all the way to the top.
 */
function youHead(kicker: string, title: string, right?: Node): Node {
  const u = YOU_UI;
  return {
    type: "Stack",
    style: {
      backgroundColor: u.accent,
      paddingTop: u.head.paddingTop,
      paddingBottom: u.head.paddingBottom,
      paddingHorizontal: u.padding,
      borderBottomLeftRadius: u.head.radius,
      borderBottomRightRadius: u.head.radius,
    },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
        children: [youBack(), ...(right ? [right] : [])],
      },
      { type: "Text", props: { content: kicker },
        style: { fontSize: u.head.kickerSize, letterSpacing: u.head.kickerTracking,
                 textTransform: "uppercase", color: u.onAccentDim, marginTop: u.head.gap } },
      { type: "Text", props: { content: title },
        style: { fontSize: u.head.titleSize, fontWeight: "800",
                 letterSpacing: u.head.titleTracking, color: u.onAccent, marginTop: 2 } },
    ],
  };
}

/** A small action on a pill. `solid` is the one that commits. */
function youChip(label: string, onPress: ActionRef, solid = false): Node {
  const u = YOU_UI;
  return {
    type: "Stack",
    on: { onPress },
    props: { pressOpacity: 0.65 },
    style: {
      height: u.chip.height, borderRadius: u.chip.radius,
      paddingHorizontal: u.chip.paddingHorizontal,
      alignItems: "center", justifyContent: "center",
      backgroundColor: solid ? u.accent : u.chip.soft,
    },
    children: [{
      type: "Text", props: { content: label },
      style: { fontSize: u.chip.fontSize, fontWeight: "700",
               letterSpacing: u.chip.tracking, color: solid ? u.onAccent : u.accent },
    }],
  };
}

/** A section label on the black ground. Small, spaced, never a heading. */
function youLabel(content: string): Node {
  const u = YOU_UI;
  return {
    type: "Text", props: { content },
    style: { fontSize: u.label.size, letterSpacing: u.label.tracking,
             textTransform: "uppercase", color: u.textFaint,
             marginTop: u.label.marginTop, marginBottom: u.label.marginBottom },
  };
}

function personalityScreen(ctx: ScreenContext): ScreenResponse {
  const u = YOU_UI;
  const d = u.deck;
  const g = u.greet;

  /**
   * The greeting, top left.
   *
   * Two nodes, not one: the app is handed a word list and a name, and given
   * no say in either. FlipText knows how to turn one word into the next and
   * nothing else — which words, how long they hold, how they are set and
   * where they sit are all decided here.
   *
   * A person with no name saved gets the hello alone rather than a greeting
   * addressed to nobody.
   */
  const name = (ctx.name ?? "").trim();
  const greeting: Node = {
    type: "Stack",
    style: { position: "absolute", top: g.top, left: g.left },
    children: [
      {
        type: "FlipText",
        props: {
          words: helloCycle(),
          intervalMs: g.intervalMs,
          flipMs: g.flipMs,
          flip: g.flip,
          variant: "greetHello",
        },
        // The height again, on the node. A lineHeight makes the text sit the
        // same inside its box; a height makes the box the same. Both, or a
        // script whose glyphs overrun the line still grows the row.
        style: { height: g.hello.lineHeight },
      },
      ...(name
        ? [{
            type: "Text",
            // Trimmed, not wrapped. A second line would push the greeting
            // down into the deck, and the deck is what this screen is for.
            props: { content: name, variant: "greetName", numberOfLines: g.nameLines },
            style: { marginTop: g.gap, maxWidth: g.nameMaxWidth },
          } as Node]
        : []),
    ],
  };

  /** One card: the topic's art, a scrim, and its name. Nothing else is on it. */
  const deckCard = (c: (typeof YOU_CARDS)[number]): Node => ({
    type: "Stack",
    style: {
      flex: 1, borderRadius: d.radius, overflow: "hidden",
      backgroundColor: "#141418",
    },
    children: [
      { type: "Image", props: { source: mediaSrc(c.media), contentFit: "cover" },
        style: { ...FILL_STYLE } },
      // BLURRED, like the backdrop it is cut from.
      //
      // The card carries a name, not a picture — the art is there to give the
      // deck a colour and a mood, and a sharp photograph competes with the one
      // word that is actually being chosen. Blurring it also makes every
      // upload behave: the deck reads the same whether someone puts a portrait
      // or a screenshot behind a card.
      ...(d.cardBlur > 0 ? [{
        type: "BlurBackground",
        props: { intensity: d.cardBlur, tint: d.cardBlurTint },
        style: { ...FILL_STYLE },
      } as Node] : []),
      // Under the title, over the art. A card whose art comes back pale is a
      // card whose title has vanished, and the art is uploaded — so the tint
      // is not a treatment, it is the guarantee that the deck stays readable
      // whatever anyone uploads to it.
      { type: "Stack",
        style: { ...FILL_STYLE, backgroundColor: d.scrim, opacity: d.scrimOpacity } },
      { type: "Text", props: { content: c.title },
        style: { position: "absolute", left: 15, right: 15, bottom: 13,
                 fontSize: d.titleSize, fontWeight: "700",
                 letterSpacing: d.titleTracking, color: "#FFFFFF" } },
    ],
  });

  /**
   * The note under the deck, one per card, only one ever on screen.
   *
   * FOUR STACKED NODES GATED ON `deck`, not one whose text changes — the same
   * shape the backdrop uses. A single node re-reading its content would swap
   * words mid-turn while the card is still moving; four that appear and
   * disappear are each finished before they are seen, and cost nothing but a
   * little JSON.
   *
   * `deck` is written by the Coverflow's onChange, which fires as the card
   * reaches the middle rather than when the finger lifts — so the note
   * belongs to whatever is centred at that instant, including a throw the
   * user is still watching.
   */
  /** This card's slices, read once — the presence check and the chart must
   *  never disagree about whether there is anything to draw. */
  const chartSlices = (c: (typeof YOU_CARDS)[number], k: ScreenContext): Slice[] =>
    c.chart ? c.chart(k) : [];

  const infoBox = (c: (typeof YOU_CARDS)[number], i: number): Node => ({
    type: "Stack",
    visibleIf: { eq: ["deck", i] },
    style: {
      flexDirection: "row", alignItems: "center", gap: u.info.gap,
      backgroundColor: u.info.background, borderRadius: u.info.radius,
      paddingHorizontal: u.info.paddingHorizontal,
      paddingVertical: u.info.paddingVertical,
      marginHorizontal: u.info.marginHorizontal,
      marginTop: u.info.marginTop, marginBottom: u.info.marginBottom,
    },
    children: [
      // A SMALL PIE AND NOTHING WRITTEN ON IT.
      //
      // This strip is the card's caption: a sentence about what the thing is,
      // and a way in. The chart is here to show the shape of it at a glance —
      // mostly used, evenly split, one voice doing everything — and a shape
      // needs no number to be read. Percentages, a label in the middle and a
      // legend all belong on Stats, which is the screen for reading rather
      // than glancing, and putting them here would make a caption into a
      // report.
      //
      // Absent entirely when there is nothing to show. An empty chart in a
      // strip this size is a hole with a caption in it; the box simply goes
      // back to being the sentence and the button it was before.
      ...(chartSlices(c, ctx).length
        ? [pieNode({
            slices: chartSlices(c, ctx),
            size: u.info.chart.size,
            thickness: u.info.chart.thickness,
            gap: u.info.chart.gap,
            emptyLabel: "",
          })]
        : []),
      {
        type: "Text",
        props: { content: c.blurb },
        style: {
          flex: 1, fontSize: u.info.textSize, fontWeight: u.info.textWeight,
          lineHeight: u.info.textLineHeight, color: u.info.text,
        },
      },
      {
        type: "Stack",
        // The SAME destination as the card above it. Two ways in, one place —
        // a second way that went somewhere else would be a third card.
        on: { onPress: { kind: "sequence", actions: [
          { kind: "haptic", style: "selection" },
          { kind: "navigate", screenId: c.screen },
        ] } },
        props: { pressOpacity: 0.65 },
        style: {
          height: u.info.cta.height, borderRadius: u.info.cta.radius,
          paddingHorizontal: u.info.cta.paddingHorizontal,
          alignItems: "center", justifyContent: "center",
          backgroundColor: u.info.cta.background,
        },
        children: [{
          type: "Text", props: { content: c.cta },
          style: {
            fontSize: u.info.cta.fontSize, fontWeight: "700",
            letterSpacing: u.info.cta.tracking, color: u.info.cta.text,
          },
        }],
      },
    ],
  });

  /**
   * Where a tap goes.
   *
   * `condition` reads a STATE PATH, never the event — so the handler writes
   * which card was chosen and then branches on what it wrote. That is safe
   * here and only here: the store is a plain mutable object, so a set is
   * visible to the very next action in the sequence rather than after a
   * render. Built by recursion off YOU_CARDS so the chain cannot fall out of
   * step with the deck it is routing.
   */
  const route = (i: number): ActionRef =>
    i >= YOU_CARDS.length - 1
      ? { kind: "navigate", screenId: YOU_CARDS[YOU_CARDS.length - 1].screen }
      : {
          kind: "condition",
          if: { eq: ["deck", i] },
          then: { kind: "navigate", screenId: YOU_CARDS[i].screen },
          else: route(i + 1),
        };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality",
    title: "",
    // The backdrop runs to the top of the window. The tabs stay — this is a
    // tab root, and taking them away here strands the user.
    hideHeader: true,
    state: { deck: 0 },
    actions: {
      /** A different card reached the middle. Only the backdrop cares. */
      centre: { kind: "setState", path: "deck", value: "$event" },
      /** A card was chosen: record which, then go where that says. */
      open: {
        kind: "sequence",
        actions: [{ kind: "setState", path: "deck", value: "$event" }, route(0)],
      },
      // The button that fired this is gone from the tab by owner decision.
      // The ACTION stays defined on purpose.
      //
      // App Review 2.5.4 wants a background capture to be stoppable without
      // force-quitting. Three things still satisfy that without a button: iOS
      // paints its own recording indicator the whole time, the keyboard's mic
      // stops the session, and FlowSessionManager ends it after five idle
      // minutes on its own. If a reviewer disagrees, putting the control back
      // is re-adding one node here — no build.
      endFlow: {
        kind: "sequence",
        actions: [
          { kind: "endFlowSession" },
          { kind: "toast", message: "Background microphone turned off.", tone: "success" },
        ],
      },
    },
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: u.ground },
      children: [
        // THE BACKDROP IS THE MIDDLE CARD'S OWN ART, blurred past reading and
        // washed back toward the ground. So the screen changes colour as the
        // deck turns, and the card in the middle is the one thing lighting the
        // room — which is the difference between a deck ON a background and a
        // deck that HAS one.
        //
        // Four stacked images gated on which is centred, rather than one image
        // whose source changes: a source swap is a load, and a load is a black
        // frame in the middle of a gesture.
        ...YOU_CARDS.map((c, i) => ({
          type: "Image",
          visibleIf: { eq: ["deck", i] },
          props: { source: mediaSrc(c.media), contentFit: "cover" },
          style: { ...FILL_STYLE },
        } as Node)),
        { type: "BlurBackground",
          props: { intensity: d.backdropBlur, tint: d.backdropTint },
          style: { ...FILL_STYLE } },
        { type: "Stack",
          style: { ...FILL_STYLE, backgroundColor: d.backdropWash,
                   opacity: d.backdropWashOpacity } },
        {
          type: "Coverflow",
          props: {
            cardWidth: d.cardWidth, cardHeight: d.cardHeight, radius: d.radius,
            step: d.step, rotation: d.rotation, depth: d.depth,
            perspective: d.perspective, shrink: d.shrink, fade: d.fade,
            stiffness: d.stiffness, damping: d.damping, mass: d.mass,
            throwFactor: d.throwFactor,
            // ONE TAP TO LOOK, ONE TO ENTER.
            //
            // A side card is turned away, shrunk and half-covered by its
            // neighbours, so what the thumb lands on is not what the eye was
            // on — a tap that opened it was a tap you then had to undo. Now a
            // side tap only brings the card to the middle, and the second tap,
            // on a card that is finally facing you, is the one that commits.
            tapToCentre: d.tapToCentre,
            // REMEMBER WHERE IT WAS LEFT. Opening a card unmounts this screen,
            // so coming back rebuilt the deck at card one and the card you were
            // just inside was two throws away. Named, because remembering is a
            // decision — a deck of search results should not do this.
            memory: d.memory,
          },
          // onChange is the deck moving; onSelect is the user choosing. The
          // backdrop follows the first and must not wait for the second.
          on: { onSelect: "open", onChange: "centre" },
          style: { flex: 1 },
          children: YOU_CARDS.map(deckCard),
          // A bundle without Coverflow still has a way into all four screens.
          fallback: {
            type: "Stack",
            style: { flex: 1, justifyContent: "center", paddingHorizontal: u.padding },
            children: YOU_CARDS.map((c) => ({
              type: "Stack",
              on: { onPress: { kind: "navigate", screenId: c.screen } },
              props: { pressOpacity: 0.7 },
              style: {
                backgroundColor: u.pill.background, borderRadius: u.pill.radius,
                paddingVertical: 14, paddingHorizontal: 18, marginBottom: 8,
              },
              children: [{ type: "Text", props: { content: c.title },
                style: { fontSize: 15, fontWeight: "700", color: u.text } }],
            } as Node)),
          },
        },

        // Under the deck, in flow rather than over it: the deck has flex and
        // gives back whatever this takes, so the cards sit up by exactly the
        // height of the note instead of being covered by it.
        ...YOU_CARDS.map(infoBox),

        // Last in the list, so they paint over the deck. The greeting and the
        // gear share a line: who this is on the left, the way out on the right.
        greeting,
        settingsGear("dark"),
      ],
    },
    // SHORTER NOW THAT THE CARDS CARRY NUMBERS.
    //
    // The four cards' CONTENTS change only when the user changes them, and
    // every one of those writes drops the cache — 120s was right for that.
    // The rings do not work that way: they move every time the person
    // dictates anything, from the keyboard, in another app, without ever
    // opening this tab. A two-minute window meant coming back to a chart that
    // did not include what you just wrote.
    //
    // 45s matches the Stats tab, which charts the same rows. Fresh on any
    // return that was not a bounce, and still cached across the bounce.
    cacheTtlSeconds: 45,
  };
}

/**
 * The Voice list — every tone (built-in + the user's custom ones), opened from
 * the Voice card on the You tab. The active tone is tinted; tapping a tone opens
 * the two-field editor (name + prompt). The "＋ Add a tone" button opens the
 * same editor with empty fields to create a new one.
 */
function voicesScreen(ctx: ScreenContext): ScreenResponse {
  const p = ctx.personality;
  const effective = applyPresetOverrides(p.presetOverrides);
  const pinned = Array.isArray(p.pinnedPresetIds) ? p.pinnedPresetIds : [];
  // The keyboard set, in pin order; ids whose preset was deleted are dropped.
  const kbVoices = pinned
    .map((id) => effective.find((e) => e.id === id))
    .filter((e): e is (typeof effective)[number] => !!e);

  // Small trailing action on a pill. Nested pressables win over the pill press
  // (standard RN nesting), so these never also activate the voice.
  const rowBtn = (label: string, onPress: ActionRef): Node => youChip(label, onPress);
  const pinAction = (presetId: string, pinnedFlag: boolean): ActionRef => ({
    kind: "sequence",
    actions: [
      { kind: "haptic", style: "selection" },
      {
        kind: "callEndpoint",
        method: "POST",
        path: "/v1/personality/pin",
        body: { presetId, pinned: pinnedFlag },
        onSuccess: "pinChanged",
        onError: "pinErr",
      },
    ],
  });

  // One voice row. Tap = make it the ACTIVE voice (what refine writes with);
  // the trailing buttons manage the keyboard set / open the editor.
  const voiceRow = (preset: (typeof effective)[number], where: "kb" | "all"): Node => {
    const isPinned = pinned.includes(preset.id);
    const up = YOU_UI.pill;
    return {
      // A PILL, not a card. Every list on the four You screens is the same
      // shape — a voice, a language, a saved word — so the shape is learnt
      // once and each screen is only its contents.
      type: "Stack",
      props: { pressOpacity: 0.7 },
      style: {
        flexDirection: "row", alignItems: "center", gap: up.gap,
        backgroundColor: up.background, borderRadius: up.radius,
        paddingLeft: up.paddingLeft, paddingRight: up.paddingRight,
        paddingVertical: up.paddingVertical, minHeight: up.minHeight,
        marginBottom: up.marginBottom,
      },
      on: { onPress: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        {
          kind: "callEndpoint",
          method: "PUT",
          path: "/v1/personality",
          // Carry the voice's tone along so the keyboard's tone pill follows
          // the voice instead of keeping a stale tone.
          body: {
            activePresetId: preset.id,
            ...(preset.defaultTone ? { activeTone: preset.defaultTone } : {}),
          },
          onSuccess: "activated",
          onError: "activateErr",
        },
      ] } },
      // Flat. The pill IS the row now, so the extra Stack that used to make one
      // inside the card is a box around nothing.
      children: [
        // No "Active" badge, and no bolding or tinting of the active row.
        //
        // Every voice in this list is one tap from being the one you write
        // with, so marking one of them is telling the user about a mode they
        // did not choose to be in and cannot see the consequences of. It read
        // as a status they had to manage. Tapping still switches voices — the
        // toast says so — and the keyboard's own tone pill is where "which
        // voice am I writing in" belongs, because that is where the writing
        // happens.
        { type: "Text", props: { content: preset.name }, style: {
          flex: 1,
          fontSize: up.labelSize,
          fontWeight: "600",
          color: YOU_UI.text,
        } },
        ...(where === "kb"
          ? [rowBtn("Remove", pinAction(preset.id, false))]
          : [
              // Already-pinned voices are managed from the keyboard set above,
              // so the library row only offers Add when it's not there yet.
              ...(!isPinned ? [rowBtn("Add", pinAction(preset.id, true))] : []),
              // Editing happens ON this screen, in a card. Leaving for a full
              // screen loses the list you were comparing against — and the
              // whole reason you opened Edit was something you saw in that list.
              rowBtn("Edit", { kind: "sequence", actions: [
                { kind: "haptic", style: "selection" },
                { kind: "setState", path: "vcId", value: preset.id },
                { kind: "setState", path: "vcName", value: preset.name },
                { kind: "setState", path: "vcPrompt",
                  value: (preset as { promptStyle?: string }).promptStyle ?? "" },
                { kind: "setState", path: "vcOpen", value: true },
              ] }),
            ]),
      ],
    };
  };

  // NO CARDS. Two labelled runs of pills on the black ground instead — a card
  // around a list of pills is a box around a box, and the label already says
  // where one run stops and the next starts.
  //
  // The two runs stay: which voices reach the keyboard is a different question
  // from which voices exist, and it is the one the user came here to answer.
  const keyboardSet: Node[] = [
    youLabel("On the keyboard"),
    // Only when the list is EMPTY. A populated list is self-explanatory — the
    // pills carry Remove — and the sentence was a wall of grey above it.
    ...(kbVoices.length ? [] : [{
      type: "Text",
      props: { content: "Nothing here yet. Add one from below." },
      style: { fontSize: 12, color: YOU_UI.textDim, marginBottom: 10 },
    } as Node]),
    ...kbVoices.map((e) => voiceRow(e, "kb")),
  ];

  const allSet: Node[] = [
    youLabel("All voices"),
    ...effective.map((e) => voiceRow(e, "all")),
  ];

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "voices",
    title: "Voice",
    // Seeded so the card's bound fields render empty rather than undefined
    // before anything has been opened.
    state: { vcOpen: false, vcId: "", vcName: "", vcPrompt: "" },
    actions: {
      // Open the editor with NO presetId → the "new tone" path.
      addTone: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "navigate", screenId: "tone_edit" },
      ] },
      // addKbTone — "create it AND pin it" — went with the button that fired
      // it. The tone_edit screen still honours params.pin, so restoring the
      // shortcut is one node here and nothing on the client.
      // A voice was made active: confirm + re-render so the "Active" badge
      // moves. The keyboard picks it up on its next config fetch.
      activated: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "refresh" },
      ] },
      activateErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't switch voices — check your connection and try again.",
      },
      // Keyboard set changed (Add/Remove): re-render both cards.
      pinChanged: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "refresh" },
      ] },
      pinErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't update the keyboard voices — check your connection and try again.",
      },
      vcSaved: { kind: "sequence", actions: [
        { kind: "setState", path: "vcOpen", value: false },
        { kind: "toast", message: "Voice saved.", tone: "success" },
        { kind: "refresh" },
      ] },
      vcSaveErr: { kind: "toast", tone: "error", message: "Couldn't save that voice. Try again." },
    },
    // The amber block reaches the top of the window, so the app's own header
    // has to go. The block carries the way back in its place.
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        // The ＋ sits ON the amber, at the top right — the one place on the
        // screen that is not a list, which is what makes it findable in a
        // screen that is otherwise entirely list.
        youHead("How it writes", "Voice",
          youHeadIcon("M12 5 L12 19 M5 12 L19 12", "addTone")),
        {
          type: "Screen",
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: YOU_UI.padding, paddingTop: 4, paddingBottom: 28,
          },
          children: [
            ...keyboardSet,
            ...allSet,
            // NO SECOND ADD BUTTON. The ＋ on the header already makes a voice,
            // and any row's Add puts one on the keyboard — so a full-width pill
            // for "make one AND pin it" was a shortcut through two steps the
            // user can already see, sitting at the bottom of a list it had
            // nothing to do with.
          ],
        },

        // ---- Edit a voice, without leaving the list ----
        // Same shape as the training card: blurred behind, cross and
        // tap-outside both exit, Save writes and closes.
        {
          type: "Modal",
          bind: { open: "vcOpen" },
          props: { blur: true, blurIntensity: 70, dismissable: true },
          on: { onDismiss: { kind: "setState", path: "vcOpen", value: false } },
          children: [
            {
              type: "Stack",
              style: { direction: "row", alignItems: "center", gap: 10, marginBottom: 14 },
              children: [
                { type: "Text", bind: { content: "vcName" },
                  style: { flex: 1, fontSize: 22, fontWeight: "800", color: "#FFFFFF" } },
                {
                  type: "Button",
                  props: { label: "\u00d7", variant: "ghost" },
                  style: { paddingHorizontal: 10, paddingVertical: 2, fontSize: 26, color: "rgba(255,255,255,0.55)" },
                  on: { onPress: { kind: "setState", path: "vcOpen", value: false } },
                },
              ],
            },
            { type: "Overline", props: { content: "Name" },
              style: { color: "rgba(255,255,255,0.4)", marginBottom: 8 } },
            { type: "TextField", bind: { value: "vcName" },
              props: { placeholder: "Voice name" }, style: { marginBottom: 16 } },
            { type: "Overline", props: { content: "How it writes" },
              style: { color: "rgba(255,255,255,0.4)", marginBottom: 8 } },
            { type: "TextField", bind: { value: "vcPrompt" },
              props: { placeholder: "Short, warm, no filler\u2026", multiline: true },
              style: { minHeight: 132, marginBottom: 16 } },
            {
              type: "Stack",
              style: { direction: "row", gap: 10 },
              children: [
                { type: "Button", props: { label: "Cancel", variant: "secondary" },
                  style: { flex: 1 },
                  on: { onPress: { kind: "setState", path: "vcOpen", value: false } } },
                { type: "Button", props: { label: "Save", variant: "primary" },
                  style: { flex: 1 },
                  on: { onPress: { kind: "sequence", actions: [
                    { kind: "haptic", style: "selection" },
                    { kind: "callEndpoint", method: "POST", path: "/v1/personality/tone",
                      body: { id: "$state.vcId", name: "$state.vcName", promptStyle: "$state.vcPrompt" },
                      onSuccess: "vcSaved", onError: "vcSaveErr" },
                  ] } } },
              ],
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 180,
  };
}

/**
 * The two-field tone editor. Opened from a tone card (edit — fields pre-filled)
 * or the "Add a tone" button (create — empty fields). Just a NAME and a PROMPT.
 * Save upserts the tone (POST /v1/personality/tone) and makes it the active
 * voice. A built-in can be Reset; a custom tone can be Deleted.
 */
function toneEditScreen(ctx: ScreenContext): ScreenResponse {
  const presetId = typeof ctx.params?.presetId === "string" ? ctx.params.presetId : undefined;
  // Opened from the "New voice for keyboard" button — the save also pins the
  // tone to the keyboard set (it lands in All voices either way).
  const pinOnSave = ctx.params?.pin === true || ctx.params?.pin === "true" || ctx.params?.pin === "1";
  const effective = applyPresetOverrides(ctx.personality.presetOverrides);
  const preset = presetId ? effective.find((e) => e.id === presetId) : undefined;
  const isBuiltin = !!presetId && PERSONALITY_PRESETS.some((b) => b.id === presetId);
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  // Save body: bake the id when editing; omit it when creating (backend mints a
  // custom id). $state.name / $state.prompt are the two fields.
  const saveBody: Record<string, unknown> = { name: "$state.name", promptStyle: "$state.prompt" };
  if (presetId) saveBody.id = presetId;
  if (pinOnSave) saveBody.pin = true;

  const label = (t: string): Node => ({ type: "Overline", props: { content: t }, style: { marginBottom: 8 } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "tone_edit",
    title: preset ? `Edit ${preset.name}` : pinOnSave ? "New keyboard voice" : "New tone",
    state: {
      name: preset?.name ?? "",
      prompt: preset?.promptStyle ?? "",
    },
    actions: {
      saveErr: { kind: "toast", tone: "error", message: "Couldn't save. Check your connection." },
      saved: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "navigateBack" },
      ] },
      save: { kind: "callEndpoint", method: "POST", path: "/v1/personality/tone", body: saveBody, onSuccess: "saved", onError: "saveErr" },
      // Reset a built-in / delete a custom — both clear the override.
      remove: { kind: "callEndpoint", method: "POST", path: "/v1/personality/tone", body: { id: presetId, remove: true }, onSuccess: "saved", onError: "saveErr" },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
      children: [
        label("Tone name"),
        { type: "TextField", bind: { value: "name" }, props: { placeholder: "e.g. Professional" } },
        gap(18),
        label("Tone prompt"),
        { type: "TextField", bind: { value: "prompt" }, props: { placeholder: "How this voice should write — e.g. Clear, warm, and direct. No filler.", multiline: true }, style: { minHeight: 120 } },
        gap(24),
        { type: "Button", props: { label: "Save", variant: "primary" }, on: { onPress: "save" } },
        ...(presetId ? [
          gap(10),
          {
            type: "Button",
            props: { label: isBuiltin ? "Reset to default" : "Delete tone", variant: isBuiltin ? "secondary" : "danger" },
            on: { onPress: "remove" },
          } as Node,
        ] : []),
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * Tone detail — reached by tapping a tone card on the Voice (You) page.
 * Deliberately spare: the tone name and its prompt, then two actions —
 * "Use this voice" (make it active) and add/remove it from the keyboard
 * toggle set. No taglines, no emoji, no supporting copy.
 */
function personalityDetailScreen(p: Personality, presetId: string | undefined): ScreenResponse {
  const effective = applyPresetOverrides(p.presetOverrides);
  const preset = effective.find((e) => e.id === presetId) ?? effective[0]!;
  const pinned = Array.isArray(p.pinnedPresetIds) ? p.pinnedPresetIds : [];
  const isPinned = pinned.includes(preset.id);
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality_detail",
    title: preset.name,
    state: { presetId: preset.id, status: "" },
    actions: {
      saveErr: { kind: "toast", tone: "error", message: "Couldn't save. Check your connection." },
      used: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "navigateBack" },
      ] },
      use: { kind: "sequence", actions: [
        { kind: "haptic", style: "medium" },
        { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: {
          activePresetId: preset.id,
          activeTone: preset.defaultTone,
        }, onSuccess: "used", onError: "saveErr" },
      ] },
      togglePin: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "callEndpoint", method: "POST", path: "/v1/personality/pin", body: { presetId: preset.id }, onSuccess: "refresh", onError: "saveErr" },
      ] },
      refresh: { kind: "refresh" },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: preset.name }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginBottom: 16 } },
        // A voice's own instruction is what describes it — except Zu's, which
        // is deliberately empty, because Zu asserts nothing and lets the
        // portrait describe the voice. Its description says so in words.
        { type: "Text", props: { content: preset.promptStyle || preset.description }, style: { fontSize: 16, color: "$color.text", lineHeight: 24 } },
        gap(28),
        { type: "Button", props: { label: "Use this voice", variant: "primary" }, on: { onPress: "use" } },
        gap(10),
        { type: "Button", props: { label: isPinned ? "Remove from keyboard" : "Add to keyboard", variant: "secondary" }, on: { onPress: "togglePin" } },
      ],
    },
    cacheTtlSeconds: 300,
  };
}

/**
 * Per-preset editor. Reached from a preset card's ✎ button. Lets the user
 * override any of the built-in preset's cosmetic + prompt fields (name,
 * emoji, tagline, description, defaultTone, promptStyle) without changing
 * the preset itself — the override lives on their profile as
 * `presetOverrides[<id>]` and is merged in on every read.
 */
function personalityEditScreen(p: Personality, presetId: string | undefined): ScreenResponse | null {
  const id = presetId ?? p.activePresetId ?? "signature";
  const base = findPreset(id);
  const override = p.presetOverrides?.[id] ?? {};
  const eff = {
    name: (override.name ?? base.name),
    tagline: (override.tagline ?? base.tagline),
    description: (override.description ?? base.description),
    defaultTone: (override.defaultTone ?? base.defaultTone),
    promptStyle: (override.promptStyle ?? base.promptStyle),
  };

  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });
  const label = (content: string): Node => ({
    type: "Text", props: { content, variant: "label" },
    style: { fontSize: 11, color: "$color.muted", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  });
  const chip = (title: string, value: string): Node => ({
    type: "Chip",
    props: { label: title, group: "editTone", value },
    on: { onPress: { kind: "haptic", style: "selection" } },
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality_edit",
    title: `Edit ${eff.name}`,
    state: {
      editPresetId: id,
      editName: eff.name,
      editTagline: eff.tagline,
      editDescription: eff.description,
      editTone: eff.defaultTone,
      editPromptStyle: eff.promptStyle,
      status: "",
    },
    actions: {
      save: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "medium" },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/personality",
            body: {
              presetOverrides: {
                [id]: {
                  name: "$state.editName",
                  tagline: "$state.editTagline",
                  description: "$state.editDescription",
                  defaultTone: "$state.editTone",
                  promptStyle: "$state.editPromptStyle",
                },
              },
            },
            onSuccess: "saved",
            onError: "saveErr",
          },
        ],
      },
      reset: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "medium" },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/personality",
            body: {
              presetOverrides: { [id]: null },
            },
            onSuccess: "resetDone",
            onError: "saveErr",
          },
        ],
      },
      saved: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          { kind: "toast", tone: "success", message: "Saved." },
          { kind: "navigateBack" },
        ],
      },
      resetDone: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          { kind: "toast", tone: "info", message: "Reset to default." },
          { kind: "navigateBack" },
        ],
      },
      saveErr: { kind: "toast", tone: "error", message: "Couldn't save. Check your connection." },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: "Edit voice" },
          style: { fontSize: 26, fontWeight: "800", color: "$color.text", marginBottom: 4 } },
        { type: "Paragraph",
          props: { content: "Rename it or reshape how it writes. Reset any time to bring the original back." },
          style: { fontSize: 13, color: "$color.muted", marginBottom: 20 } },

        label("Name"),
        { type: "TextField", bind: { value: "editName" }, props: { placeholder: "Voice name" } },
        gap(16),

        label("Emoji"),
                gap(16),

        label("Tagline"),
        { type: "TextField", bind: { value: "editTagline" }, props: { placeholder: "Short one-liner" } },
        gap(16),

        label("Description"),
        { type: "TextField", bind: { value: "editDescription" }, props: { placeholder: "How this voice sounds", multiline: true, rows: 3 } },
        gap(16),

        label("Default tone"),
        { type: "Stack", style: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }, children: [
          chip(TONE_LABELS.none, "none"),
          chip(TONE_LABELS.formal, "formal"),
          chip(TONE_LABELS.casual, "casual"),
          chip(TONE_LABELS["very-casual"], "very-casual"),
          chip(TONE_LABELS.excited, "excited"),
        ] },
        gap(16),

        label("Prompt style"),
        { type: "Paragraph",
          props: { content: "The instruction the refine step reads. Advanced — change only if you know the phrasing you want." },
          style: { fontSize: 12, color: "$color.muted", marginBottom: 8 } },
        { type: "TextField", bind: { value: "editPromptStyle" },
          props: { placeholder: "e.g. Write with a poetic ear…", multiline: true, rows: 5 } },
        gap(24),

        { type: "Button", props: { label: "Save changes", variant: "primary" }, on: { onPress: "save" } },
        gap(10),
        { type: "Button", props: { label: "Reset to default", variant: "secondary" }, on: { onPress: "reset" } },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * The "advanced" customize screen — the OLD personality form. Only reached
 * from the new personality picker when the user wants to add a dictionary
 * word, a snippet, or a sign-off on top of a selected preset. Kept
 * intentionally out of the main flow so first-time users don't stall on it.
 */
function personalityCustomizeScreen(p: Personality): ScreenResponse {
  const SECTION = 24;
  const label = (content: string): Node => ({ type: "Text", props: { content, variant: "label" }, style: { marginBottom: 8 } });
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality_customize",
    title: "Customize",
    state: {
      form: {
        tone: p.tone ?? "",
        formality: p.formality ?? "neutral",
        emoji: p.emoji ?? "minimal",
        vocabulary: p.vocabulary ?? "",
        customInstructions: p.customInstructions ?? "",
        signature: p.signature ?? "",
        snippets: p.snippets ?? "",
      },
      status: "",
      sample: "",
    },
    actions: {
      save: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Saving…" },
        { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: "$state.form", onSuccess: "saved", onError: "saveErr" },
      ] },
      saved: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Saved." },
        { kind: "haptic", style: "success" },
      ] },
      saveErr: { kind: "toast", message: "Couldn't save.", tone: "error" },
      learn: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Learning your voice…" },
        { kind: "callEndpoint", method: "POST", path: "/v1/personality/learn", body: { sample: "$state.sample" }, onSuccess: "learned", onError: "saveErr" },
      ] },
      learned: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "toast", message: "Learned.", tone: "success" },
        { kind: "refresh" },
      ] },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: "Customize" }, style: { fontSize: 26, fontWeight: "800", color: "$color.text", marginBottom: 6 } },
        { type: "Paragraph", props: { content: "Fine-tune the selected voice with your own dictionary, sign-off, and instructions." }, style: { marginBottom: SECTION } },

        label("Sign-off (optional)"),
        { type: "TextField", bind: { value: "form.signature" }, props: { placeholder: "— A" } },
        gap(SECTION),

        label("Words it should know"),
        { type: "TextField", bind: { value: "form.vocabulary" }, props: { placeholder: "Aarav\nNykaa\nKubernetes", multiline: true } },
        gap(SECTION),

        label("Custom instructions"),
        { type: "TextField", bind: { value: "form.customInstructions" }, props: { placeholder: "avoid exclamation marks, use British spelling", multiline: true } },
        gap(SECTION),

        label("Snippets — trigger = expansion, one per line"),
        { type: "TextField", bind: { value: "form.snippets" }, props: { placeholder: "brb = be right back\naddr = 42 Baker St", multiline: true } },
        gap(SECTION),

        { type: "Button", props: { label: "Save", variant: "primary" }, on: { onPress: "save" } },
        { type: "Text", bind: { content: "status" }, props: { variant: "muted" }, style: { marginTop: 10, textAlign: "center" } },

        gap(28),
        { type: "Divider" },
        gap(20),

        label("Or learn my voice from a sample"),
        { type: "TextField", bind: { value: "sample" }, props: { placeholder: "Paste a few messages you've written…", multiline: true } },
        gap(10),
        { type: "Button", props: { label: "Learn my voice", variant: "secondary" }, on: { onPress: "learn" } },
      ],
    },
    cacheTtlSeconds: 300,
  };
}

/** Reply helper — drafts a personalized reply via /v1/draft. */
function replyScreen(): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "reply",
    title: "Reply helper",
    state: { screenContent: "", intent: "", busy: false, result: {} },
    actions: {
      draft: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "busy", value: true },
          {
            kind: "callEndpoint",
            method: "POST",
            path: "/v1/draft",
            body: {
              screenContent: "$state.screenContent",
              intent: "$state.intent",
              targetApp: "WhatsApp",
              language: "auto",
            },
            assignTo: "result",
            onSuccess: "draftDone",
            onError: "draftErr",
          },
        ],
      },
      draftDone: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "busy", value: false },
          { kind: "haptic", style: "success" },
        ],
      },
      draftErr: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "busy", value: false },
          { kind: "toast", message: "Couldn't draft. Check Connection + your key.", tone: "error" },
        ],
      },
    },
    root: {
      type: "Screen",
      children: [
        { type: "Overline", props: { content: "Reply" } },
        text("Reply helper", "h1"),
        { type: "Paragraph", props: { content: "Paste what you got, say what you mean — get a reply in your voice." }, style: { marginBottom: 20 } },
        text("What they wrote", "label"),
        {
          type: "TextField",
          bind: { value: "screenContent" },
          props: { placeholder: "Paste the message you received…", multiline: true },
        },
        spacer(12),
        text("What you want to say", "label"),
        {
          type: "TextField",
          bind: { value: "intent" },
          props: { placeholder: "politely decline, suggest next week" },
        },
        spacer(12),
        { type: "Button", props: { label: "Draft reply", variant: "primary" }, on: { onPress: "draft" } },
        spacer(16),
        { type: "ProgressBar", visibleIf: { truthy: "busy" } },
        {
          type: "Card",
          visibleIf: { truthy: "result.draftText" },
          motion: { appear: "fadeInUp" },
          children: [text("", "body", { bind: { content: "result.draftText" } })],
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/** Settings — server-driven app info, account, and links. */
function settingsScreen(ctx: ScreenContext): ScreenResponse {
  // Language is NOT here. It lives on the You tab, with the rest of what the
  // app knows about the person — voices, dictionary, haptics. Two doors to one
  // setting is how the two get out of step in someone's head, and Settings is
  // the wrong one: it is where the account and the legal links live, not where
  // the product is shaped.
  // Row helper attaches a Button-styled-as-row fallback so old bundles that
  // lack the "Row" component still render each Settings item as a full-width
  // tappable strip, not a pill. Uses only v1 primitives (Button + style
  // overrides) which the shipped bundle understands.
  const row = (label: string, action: ActionRef, extra: Partial<Node> = {}): Node => {
    const extraProps = (extra.props as Record<string, unknown> | undefined) ?? {};
    const danger = extraProps.danger === true;
    const value = extraProps.value as string | undefined;
    // Use the value in the label if present (v1 Button only shows props.label,
    // not a separate value slot). Wraps the label to avoid missing context.
    const rowLabel = value ? `${label}    ${value}` : label;
    return {
      type: "Row",
      props: { label },
      on: { onPress: action },
      ...extra,
      fallback: {
        type: "Button",
        props: {
          label: rowLabel,
          variant: danger ? "danger" : "secondary",
        },
        on: { onPress: action },
        // Style the button to read as a full-width row with a hairline
        // divider below — closer to iOS list rows than a pill.
        style: {
          width: "100%",
          borderRadius: 0,
          paddingVertical: 16,
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderColor: "rgba(255,255,255,0.06)",
          backgroundColor: "transparent",
        },
      },
    };
  };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "settings",
    title: "",
    state: { language: ctx.language },
    actions: {
      signOut: { kind: "signOut" },
      privacy: { kind: "openUrl", url: "https://tailzu.space/privacy", external: true },
      terms: { kind: "openUrl", url: "https://tailzu.space/terms", external: true },
      // openHistory / historyOn removed with the rows that fired them —
      // Settings no longer has a History entry or a retention toggle. History
      // stays reachable from Stats, which keeps its own openHistory alias.
      err: { kind: "toast", message: "Couldn't save that. Try again.", tone: "error" },
    },
    root: {
      type: "Screen",
      children: [
        ...screenHero("settings"),
        // Left-aligned title, tighter gap. The prior right-aligned title with a
        // 64 px gap made the list appear to be missing when the first rows fell
        // just below the fold.
        { type: "Heading", props: { content: "Settings" }, style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 20 } },

        // Personality and Stats are BOTTOM TABS — listing them here too was
        // two doors to one room. Dictionary is reached from the You tab.
        //
        // History and "Keep my history" are gone from Settings by owner
        // decision. NOTE the consequence, because it is not cosmetic: the
        // retainHistory consent flag now has NO switch anywhere in the app, so
        // it stays at its default of OFF, nothing is ever written to
        // cleanup_history, and the History screen — still reachable from Stats
        // — will always be empty. The screen and its endpoint are left intact
        // so restoring the toggle is a backend edit if that is wanted later.

        // THE WAY IN. Until this row existed there was none.
        //
        // The paywall could only be reached by running out of words: the
        // post-onboarding prompt is off, the hard gate is off, and nothing else
        // navigated there. So a user who wanted to pay had to first be stopped,
        // and an App Review tester — who will never dictate eight hundred words
        // — would have reported the in-app purchases as unlocatable and had
        // them rejected. Two auto-renewing products, submitted with no door.
        //
        // Hidden from anyone who has already paid, by the flag the client
        // already holds from the bootstrap, so it costs no extra call and
        // updates on the next foreground. `not` + `flag` are both understood by
        // every shipped bundle, and visibleIf is evaluated before the fallback,
        // so an old client renders nothing rather than a row it cannot hide.
        {
          ...row("Upgrade", { kind: "navigate", screenId: "paywall" }, { props: { label: "Upgrade" } }),
          visibleIf: { not: { flag: "billing.entitled" } },
        },

        // Preferences

        // Legal + account
        row("Privacy Policy", "privacy", { props: { label: "Privacy Policy" } }),
        row("Terms of Use", "terms", { props: { label: "Terms of Use" } }),
        row("Sign out", "signOut", { props: { label: "Sign out", chevron: false } }),
        row("Delete account", { kind: "navigate", screenId: "delete_account" }, { props: { label: "Delete account", danger: true, chevron: false } }),
      ],
    },
    cacheTtlSeconds: 300,
  };
}
/**
 * TWO COLOURS, AND THAT IS THE WHOLE DESIGN RULE.
 *
 * The brand amber is the ground and near-black is the ink — the inverse of
 * every other screen, which is what makes this tab read as its own place
 * rather than Home with charts on it. Nothing else appears: no greys, no
 * second accent, no semantic red or green.
 *
 * That constraint is most of the work in the charts. Normally hue separates
 * one series from another; with one hue, WEIGHT and OPACITY have to do it —
 * bars sit at 45% with the peak at full, the streak grid uses three steps of
 * opacity, and rows separate on a 13%-alpha rule rather than a border colour.
 * It holds, but it means no chart here can encode two series by colour: a card
 * that needs that needs two charts.
 */
const STATS_UI = {
  ground: ACCENT_AMBER,
  ink: "#0B0B0D",
  /** Ink at reduced strength, for everything that is not the number itself. */
  inkDim: "rgba(11,11,13,0.62)",
  inkFaint: "rgba(11,11,13,0.42)",
  /** Amber on the black cards, at the strengths the two-colour rule allows. */
  onCard: ACCENT_AMBER,
  onCardDim: "rgba(232,162,60,0.72)",
  onCardFaint: "rgba(232,162,60,0.55)",
  rule: "rgba(232,162,60,0.13)",
  barRest: 0.45,
  cardRadius: 13,
  gap: 9,
  padding: 16,
};

function statsScreen(ctx: ScreenContext): ScreenResponse {
  const u = STATS_UI;
  const usage = ctx.usage ?? {
    month: { words: 0, audioSeconds: 0, requests: 0 },
    total: { words: 0, audioSeconds: 0, requests: 0 },
  };
  const st = ctx.stats;

  const wordsMonth = st?.wordsOut ?? usage.month.words;
  const sessions = st?.requests ?? usage.month.requests;
  const minutesSaved = st?.minutesSaved ?? Math.max(0, Math.round(usage.total.words / 40));
  const perDay = st?.wordsPerDay ?? st?.sparklinePerDay ?? [];
  const days = perDay.length || 30;
  const daysActive = st?.daysActive ?? perDay.filter((d) => d > 0).length;
  const streak = st?.currentStreak ?? 0;
  const avgPerSession = st?.avgWordsPerSession ?? (sessions ? Math.round(wordsMonth / sessions) : 0);
  const n = (v: number) => v.toLocaleString("en-US");
  /**
   * THE ALLOWANCE, which went missing when this screen was rebuilt.
   *
   * It is the only number here that decides whether the app keeps working, and
   * the only one that goes UP on its own — so it belongs above the pretty ones
   * rather than in a panel behind them. Absent for a signed-out or unreadable
   * user, and then the meter is not drawn at all rather than drawn with zeros,
   * which would read as "you have nothing left".
   */
  const allow = ctx.allowance;
  const spokenMinutes = st?.speakingMinutes
    ?? Math.round((usage.month.audioSeconds / 60) * 10) / 10;
  /** All time, not this month — the only place the running total is shown. */
  const lifetime = usage.total;
  /** Nothing has been written yet. Zeros in a grid read as a broken screen. */
  const empty = sessions === 0 && wordsMonth === 0;

  /** Split a per-day series into equal buckets — weeks, usually. */
  const bucket = (src: number[], count: number): number[] => {
    if (!src.length) return new Array(count).fill(0);
    const size = Math.ceil(src.length / count);
    return Array.from({ length: count }, (_, i) =>
      src.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0));
  };

  /**
   * Bars, drawn from Stacks rather than a chart component — because the chart
   * components colour their own series and this screen may not have a second
   * colour. Height is the value; the tallest bar is the only one at full
   * strength, which is how a peak reads without a label on it.
   */
  const bars = (values: number[], labels: string[], height = 88): Node => {
    const max = Math.max(1, ...values);
    return {
      type: "Stack",
      children: [
        {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "flex-end", gap: 5, height },
          children: values.map((v) => ({
            type: "Stack",
            style: {
              flex: 1,
              height: Math.max(3, Math.round((v / max) * height)),
              backgroundColor: u.onCard,
              opacity: v === max ? 1 : u.barRest,
              borderTopLeftRadius: 3, borderTopRightRadius: 3,
            },
          })),
        },
        {
          type: "Stack",
          style: { flexDirection: "row", gap: 5, marginTop: 6 },
          children: labels.map((l) => ({
            type: "Text", props: { content: l },
            style: { flex: 1, textAlign: "center", fontSize: 7.5, color: u.onCardFaint },
          })),
        },
      ],
    };
  };

  /** A month of days as a grid, three opacity steps: none, some, a lot. */
  const dotGrid = (values: number[]): Node => {
    const max = Math.max(1, ...values);
    return {
      type: "Stack",
      style: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
      children: values.map((v) => ({
        type: "Stack",
        style: {
          width: "12%", aspectRatio: 1, borderRadius: 4,
          backgroundColor: u.onCard,
          opacity: v === 0 ? 0.16 : v > max * 0.5 ? 1 : 0.5,
        },
      })),
    };
  };

  const row = (label: string, value: string): Node => ({
    type: "Stack",
    style: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "baseline",
      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: u.rule,
    },
    children: [
      { type: "Text", props: { content: label }, style: { fontSize: 12, color: u.onCardDim } },
      { type: "Text", props: { content: value },
        style: { fontSize: 12, fontWeight: "700", color: u.onCard } },
    ],
  });

  const secLab = (t: string): Node => ({
    type: "Text", props: { content: t },
    style: { fontSize: 8.5, letterSpacing: 2, textTransform: "uppercase",
             color: u.onCardFaint, marginTop: 16, marginBottom: 9 },
  });

  /** One tile. The whole card is the tap target; the detail opens over it. */
  const card = (id: string, label: string, value: string, unit?: string): Node => ({
    type: "Stack",
    on: { onPress: { kind: "setState", path: "openCard", value: id } },
    props: { pressOpacity: 0.75 },
    style: {
      flex: 1, backgroundColor: u.ink, borderRadius: u.cardRadius,
      paddingTop: 11, paddingBottom: 12, paddingHorizontal: 12,
    },
    children: [
      { type: "Text", props: { content: label },
        style: { fontSize: 8, letterSpacing: 1.8, textTransform: "uppercase",
                 color: u.onCardDim, textAlign: "right" } },
      {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "baseline", marginTop: 12 },
        children: [
          { type: "Text", props: { content: value },
            style: { fontSize: 27, fontWeight: "800", letterSpacing: -1, color: u.onCard } },
          ...(unit
            ? [{ type: "Text", props: { content: unit },
                 style: { fontSize: 11, fontWeight: "700", color: u.onCardDim, marginLeft: 3 } } as Node]
            : []),
        ],
      },
    ],
  });

  /** The detail behind one card. Scrolls inside itself when it outgrows. */
  /**
   * The three field breakdowns, read once so the tile and the panel behind it
   * can never disagree about their own number.
   */
  const langRows = languageSlices(st, CHART_ON_DARK).map((sl) => ({ label: sl.label, words: sl.value }));
  const voiceRows = voiceSlices(st, ctx.personality, CHART_ON_DARK).map((sl) => ({ label: sl.label, words: sl.value }));
  const dictShare = st?.dictionary && st.dictionary.saved > 0
    ? `${Math.round((st.dictionary.used / st.dictionary.saved) * 100)}%`
    : "—";
  const topVoiceShare = (() => {
    const total = voiceRows.reduce((sum, v) => sum + v.words, 0);
    if (!total || !voiceRows.length) return "—";
    return `${Math.round((voiceRows[0]!.words / total) * 100)}%`;
  })();

  /**
   * A ring inside a panel — big, with its legend, on the black card.
   *
   * Centred rather than inline: the panel is a column of rows, and a chart
   * squeezed beside text in a column reads as an afterthought. Here it is the
   * first thing, at the size the legend needs to sit under it.
   */
  const ring = (slices: Slice[], centerValue: string, centerLabel: string, empty: string): Node =>
    pieNode({
      slices,
      size: 148,
      thickness: 22,
      legend: true,
      legendColor: u.onCard,
      ...(centerValue && centerValue !== "—" ? { centerValue, centerLabel } : {}),
      emptyLabel: empty,
      style: { alignSelf: "center", marginTop: 4, marginBottom: 8, width: "100%" },
    });

  const panel = (id: string, label: string, value: string, unit: string, inner: Node[]): Node => ({
    type: "Stack",
    visibleIf: { eq: ["openCard", id] },
    style: { flex: 1 },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
        children: [
          {
            type: "Stack",
            children: [
              { type: "Text", props: { content: label },
                style: { fontSize: 9, letterSpacing: 2.2, textTransform: "uppercase", color: u.onCardDim } },
              { type: "Text", props: { content: unit ? `${value} ${unit}` : value },
                style: { fontSize: 30, fontWeight: "800", letterSpacing: -1.1, color: u.onCard, marginTop: 6 } },
            ],
          },
          {
            type: "Stack",
            on: { onPress: "closeCard" },
            style: {
              width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: u.rule,
              alignItems: "center", justifyContent: "center",
            },
            children: [{
              type: "SVG",
              props: { viewBox: "0 0 24 24", d: "M6 6 L18 18 M18 6 L6 18",
                       fill: "none", stroke: u.onCard, strokeWidth: 2.4 },
              style: { width: 11, height: 11 },
            }],
          },
        ],
      },
      { type: "Screen", style: { backgroundColor: "transparent", paddingHorizontal: 0, paddingTop: 4 },
        children: inner },
    ],
  });

  const weeks = bucket(perDay, 4);
  const wLabels = ["W1", "W2", "W3", "W4"];
  const dayparts = st?.daypartSessions;
  const apps = st?.topApps ?? [];

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "stats",
    title: "",
    // The amber runs to the top of the window; the tabs stay, because this is
    // a tab root and losing them here strands the user.
    hideHeader: true,
    state: { openCard: "" },
    actions: {
      closeCard: { kind: "clearState", path: "openCard" },
      openHistory: { kind: "navigate", screenId: "history" },
    },
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: u.ground },
      children: [
        {
          type: "Screen",
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: u.padding, paddingTop: 58, paddingBottom: 20,
          },
          children: [
            { type: "Text", props: { content: "This month" },
              style: { fontSize: 9, letterSpacing: 3, textTransform: "uppercase",
                       color: u.inkDim, marginBottom: 2, marginLeft: 4 } },
            {
              type: "Stack",
              style: { flexDirection: "row", alignItems: "baseline", marginLeft: 2, marginBottom: 4 },
              children: [
                { type: "Text", props: { content: n(wordsMonth) },
                  style: { fontSize: 62, lineHeight: 62, fontWeight: "800",
                           letterSpacing: -2.6, color: u.ink } },
                { type: "Text", props: { content: "words" },
                  style: { fontSize: 14, fontWeight: "700", color: u.inkDim, marginLeft: 8 } },
              ],
            },
            { type: "Text", props: { content: "Spoken, cleaned, and sent as you." },
              style: { fontSize: 10.5, color: u.inkDim, marginBottom: 16, marginLeft: 4 } },

            // NOTHING YET. A grid of zeros reads as a screen that is broken
            // rather than as a month that has not started, and it is the first
            // thing a new user sees on this tab.
            ...(empty ? [{
              type: "Stack",
              style: {
                backgroundColor: u.ink, borderRadius: u.cardRadius,
                paddingVertical: 22, paddingHorizontal: 16,
              },
              children: [
                { type: "Text", props: { content: "Nothing here yet." },
                  style: { fontSize: 16, fontWeight: "700", color: u.onCard } },
                { type: "Text",
                  props: { content: "Dictate or refine a few messages and this fills in — words a day, streaks, where and when you write." },
                  style: { fontSize: 11.5, lineHeight: 17, color: u.onCardDim, marginTop: 6 } },
              ],
            } as Node] : []),

            // THE ALLOWANCE. Above the grid, because it is the only number on
            // this screen that decides whether the app keeps working — and the
            // only one that goes up on its own. Tapping opens where it came
            // from. Not drawn at all when there is no allowance to read, rather
            // than drawn with zeros, which would say "you have nothing left".
            ...(allow ? [{
              type: "Stack",
              on: { onPress: { kind: "setState", path: "openCard", value: "words" } },
              props: { pressOpacity: 0.75 },
              style: {
                backgroundColor: u.ink, borderRadius: u.cardRadius,
                paddingTop: 12, paddingBottom: 14, paddingHorizontal: 14,
                marginBottom: u.gap,
              },
              children: [
                {
                  type: "Stack",
                  style: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
                  children: [
                    { type: "Text", props: { content: "Words left" },
                      style: { fontSize: 8, letterSpacing: 1.8, textTransform: "uppercase", color: u.onCardDim } },
                    { type: "Text", props: { content: n(allow.remaining) },
                      style: { fontSize: 20, fontWeight: "800", letterSpacing: -0.6, color: u.onCard } },
                  ],
                },
                {
                  type: "WordMeter",
                  props: {
                    used: allow.used, base: allow.base, earned: allow.earned,
                    // Every colour from here, so the meter cannot introduce a
                    // third one into a screen that has exactly two.
                    fillColor: u.onCard,
                    earnedColor: u.onCard,
                    trackColor: u.rule,
                    labelColor: u.onCardFaint,
                  },
                  style: { marginTop: 10 },
                  // Older bundles get the same fact as a line of type.
                  fallback: {
                    type: "Text",
                    props: { content: `${n(allow.used)} of ${n(allow.total)} used` },
                    style: { fontSize: 11, color: u.onCardDim, marginTop: 8 },
                  },
                },
                ...(allow.earned > 0 ? [{
                  type: "Text",
                  props: {
                    content: allow.maxed
                      ? `${n(allow.earned)} earned — that is the most this month.`
                      : `${n(allow.earned)} of these you earned by turning up.`,
                  },
                  style: { fontSize: 10.5, color: u.onCardDim, marginTop: 8 },
                } as Node] : []),
              ],
            } as Node] : []),

            {
              type: "Stack",
              style: { flexDirection: "row", gap: u.gap, marginBottom: u.gap },
              children: [
                card("minutes", "Minutes saved", n(minutesSaved), "min"),
                card("sessions", "Sessions", n(sessions)),
              ],
            },
            {
              type: "Stack",
              style: { flexDirection: "row", gap: u.gap, marginBottom: u.gap },
              children: [
                card("streak", "Day streak", n(streak), "days"),
                card("active", "Active days", n(daysActive), `of ${days}`),
              ],
            },
            // The two that were built and then not shown. Per-session is the
            // shape of a habit — whether someone writes a sentence or a page —
            // and spoken minutes is the only figure here measured in the thing
            // the user actually did rather than in what came out of it.
            {
              type: "Stack",
              style: { flexDirection: "row", gap: u.gap, marginBottom: u.gap },
              children: [
                card("persession", "Per session", n(avgPerSession), "words"),
                card("spoken", "Spoken", spokenMinutes ? String(spokenMinutes) : "0", "min"),
              ],
            },
            // THE THREE FIELDS — the same things the You cards are about, in
            // the place that has room to show them properly. Each tile carries
            // the one number, and opening it gives the ring, its legend, and
            // the rows behind it.
            {
              type: "Stack",
              style: { flexDirection: "row", gap: u.gap, marginBottom: u.gap },
              children: [
                card("dictionary", "Dictionary", dictShare, dictShare === "—" ? "" : "in use"),
                card("voices", "Voices", topVoiceShare, topVoiceShare === "—" ? "" : "top"),
              ],
            },
            {
              type: "Stack",
              style: { flexDirection: "row", gap: u.gap },
              children: [
                card("languages", "Languages", String(langRows.length || "—"),
                     langRows.length ? "used" : ""),
                // The row needs a second cell or the first stretches to the
                // full width and stops matching the grid above it.
                { type: "Stack", style: { flex: 1 } },
              ],
            },

            {
              type: "Stack",
              on: { onPress: "openHistory" },
              style: {
                height: 46, borderRadius: 999, backgroundColor: u.ink,
                alignItems: "center", justifyContent: "center", marginTop: 14,
              },
              children: [{ type: "Text", props: { content: "FULL HISTORY" },
                style: { fontSize: 11, letterSpacing: 1.9, fontWeight: "700", color: u.onCard } }],
            },
          ],
        },

        // The way into Settings — see settingsGear(). INK, not white: this
        // root's ground is the brand amber, and a light glyph on it is the
        // kind of thing that survives review and cannot be seen on a phone.
        settingsGear("light"),

        // THE DETAIL. One Modal, one `openCard`, four panels gated on it —
        // rather than four Modals, which would be four things that can be open
        // at once and one bug away from being.
        {
          type: "Modal",
          bind: { open: "openCard" },
          props: { blur: true, blurIntensity: 40, blurTint: "light" },
          on: { onDismiss: "closeCard" },
          style: {
            backgroundColor: u.ink, borderRadius: 18,
            padding: 16, width: "92%", height: "76%",
          },
          children: [
            panel("minutes", "Minutes saved", n(minutesSaved), "min", [
              secLab("By week"), bars(weeks, wLabels),
              ...(apps.length ? [secLab("Where it went"),
                ...apps.map((a) => row(a.app, `${n(a.words)} words`))] : []),
              secLab("Against typing"),
              row("Words written", n(wordsMonth)),
              row("At 40 wpm, typed", `${n(Math.round(wordsMonth / 40))} min`),
              ...(st?.speakingMinutes ? [row("Spoken", `${st.speakingMinutes} min`)] : []),
            ]),
            panel("sessions", "Sessions", n(sessions), "", [
              secLab("By week"), bars(bucket(st?.sparklinePerDay ?? perDay, 4), wLabels),
              secLab("Shape"),
              row("Average per session", `${n(avgPerSession)} words`),
              ...(st?.bestDay ? [row("Best day", `${n(st.bestDay.words)} words`)] : []),
              ...(st?.kindWords ? [
                row("By voice", n(st.kindWords.voice)),
                row("By typing", n(st.kindWords.typing)),
                row("Drafted", n(st.kindWords.draft)),
              ] : []),
            ]),
            panel("streak", "Day streak", n(streak), "days", [
              secLab("This month"), dotGrid(perDay.length ? perDay : new Array(30).fill(0)),
              secLab("Records"),
              row("Current streak", `${n(streak)} days`),
              row("Best streak", `${n(st?.bestStreak ?? streak)} days`),
              row("Active days", `${n(daysActive)} of ${days}`),
            ]),
            panel("active", "Active days", n(daysActive), `of ${days}`, [
              ...(dayparts ? [secLab("Time of day"), bars(
                [dayparts.morning, dayparts.afternoon, dayparts.evening, dayparts.night],
                ["Morning", "Afternoon", "Evening", "Night"],
              )] : []),
              secLab("Pattern"),
              row("Active days", `${n(daysActive)} of ${days}`),
              row("Average per active day",
                  `${n(daysActive ? Math.round(wordsMonth / daysActive) : 0)} words`),
              ...(st?.bestDay ? [row("Biggest day", `${n(st.bestDay.words)} words`)] : []),
            ]),

            // --- the three that had no detail behind them ------------------
            panel("persession", "Per session", n(avgPerSession), "words", [
              secLab("By week"), bars(weeks, wLabels),
              secLab("Shape"),
              row("Average per session", `${n(avgPerSession)} words`),
              row("Sessions", n(sessions)),
              ...(st?.bestDay ? [row("Best day", `${n(st.bestDay.words)} words`)] : []),
              // ALL TIME, and the only place it appears. Everything above is a
              // rolling month, which is the right window for a habit and the
              // wrong one for "how much has this actually done for me".
              secLab("All time"),
              row("Words", n(lifetime.words)),
              row("Sessions", n(lifetime.requests)),
              row("Spoken", `${Math.round(lifetime.audioSeconds / 60)} min`),
            ]),

            panel("dictionary", "Dictionary", dictShare, dictShare === "—" ? "" : "in use", [
              secLab("What earns its place"),
              ring(dictionarySlices(st, CHART_ON_DARK), dictShare, "IN USE",
                   "Save a word and it starts counting"),
              ...(st?.dictionary ? [
                secLab("The list"),
                row("Saved", n(st.dictionary.saved)),
                row("Used", n(st.dictionary.used)),
                row("Never used", n(st.dictionary.unused)),
                row("Cleanups scanned", n(st.dictionary.scanned)),
              ] : []),
              ...(st?.dictionary?.top?.length ? [
                secLab("Most used"),
                ...st.dictionary.top.map((w) => row(w.word, `${n(w.uses)} cleanups`)),
              ] : []),
              // NAMED, not just counted. "Six unused" is a fact; "these six"
              // is something you can act on — prune them, or notice one is
              // spelled a way you never actually type.
              ...(st?.dictionary?.unusedWords?.length ? [
                secLab("Never turned up"),
                ...st.dictionary.unusedWords.map((w) => row(w, "—")),
              ] : []),
            ]),

            panel("voices", "Voices", topVoiceShare, topVoiceShare === "—" ? "" : "top", [
              secLab("Who writes for you"),
              ring(voiceSlices(st, ctx.personality, CHART_ON_DARK), topVoiceShare, "TOP",
                   "No writing yet"),
              ...(voiceRows.length ? [
                secLab("By words"),
                ...voiceRows.map((v) => row(v.label, n(v.words))),
              ] : []),
              // WHICH REGISTER, which is a different question from which
              // voice: a voice is who is writing, a tone is how. Zu written
              // in a formal register is still Zu.
              ...(st?.toneWords?.length ? [
                secLab("In which register"),
                ...st.toneWords.map((t) => row(TONE_LABELS[t.tone as keyof typeof TONE_LABELS] ?? t.tone, n(t.words))),
              ] : []),
            ]),

            panel("languages", "Languages", String(langRows.length || "—"),
                  langRows.length ? "used" : "", [
              secLab("What you write in"),
              ring(languageSlices(st, CHART_ON_DARK), String(langRows.length || ""), "USED",
                   "No writing yet"),
              ...(langRows.length ? [
                secLab("By words"),
                ...langRows.map((l) => row(l.label, n(l.words))),
              ] : []),
            ]),

            panel("spoken", "Spoken", spokenMinutes ? String(spokenMinutes) : "0", "min", [
              ...(dayparts ? [secLab("When you speak"), bars(
                [dayparts.morning, dayparts.afternoon, dayparts.evening, dayparts.night],
                ["Morning", "Afternoon", "Evening", "Night"],
              )] : []),
              secLab("Rate"),
              row("Spoken this month", `${spokenMinutes} min`),
              row("Words out", n(wordsMonth)),
              // The one figure here that is genuinely about the user rather
              // than about the app: how fast they talk.
              row("Words a minute",
                  spokenMinutes > 0 ? n(Math.round(wordsMonth / spokenMinutes)) : "—"),
              row("All time", `${Math.round(lifetime.audioSeconds / 60)} min`),
            ]),

            // Where the allowance came from. The meter above opens this.
            ...(allow ? [panel("words", "Words left", n(allow.remaining), "", [
              secLab("This month"),
              row("Plan", n(allow.base)),
              row("Earned by turning up", n(allow.earned)),
              row("Used", n(allow.used)),
              row("Left", n(allow.remaining)),
              ...(allow.streakDays ? [row("Day streak", `${n(allow.streakDays)} days`)] : []),
              // WHAT EACH VISIT GAVE, as bars rather than the pie this used to
              // be: a pie of thirty visits is thirty slices nobody can read,
              // and a pie needs a colour per slice on a screen that has two.
              ...(allow.perVisit.length ? [
                secLab("Earned per visit"),
                bars(
                  allow.perVisit.slice(-8).map((v) => v.words),
                  allow.perVisit.slice(-8).map((v) => v.day.slice(5)),
                ),
              ] : []),
              ...(allow.maxed
                ? [{ type: "Text",
                     props: { content: "You have earned the most you can this month." },
                     style: { fontSize: 11, color: u.onCardDim, marginTop: 14 } } as Node]
                : []),
            ])] : []),
          ],
        },
      ],
    },
    cacheTtlSeconds: 45,
  };
}


/**
 * History browser. Loads the caller's opt-in cleanup history via /v1/history
 * and renders each row as a Card. Rows tap into a placeholder toast until we
 * ship a full-fat detail screen; long-press soft-deletes via /v1/history/:id.
 */
/**
 * Words spoken vs words written, across the history rows on screen.
 *
 * wordsIn is what the user said; wordsOut is what Tailzu produced. Showing both
 * is the honest version of "look what we saved you" — the user can see the
 * whole trade rather than a number we chose.
 */
function historyBreakdown(entries: HistoryEntry[] | undefined): Array<{ label: string; value: number }> {
  const rows = entries ?? [];
  if (rows.length === 0) return [];
  const spoken = rows.reduce((n, e) => n + (e.wordsIn ?? 0), 0);
  const written = rows.reduce((n, e) => n + (e.wordsOut ?? 0), 0);
  if (spoken === 0 && written === 0) return [];
  return [
    { label: "Written", value: written },
    { label: "Spoken", value: spoken },
  ];
}

function historyScreen(ctx: ScreenContext): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "history",
    title: "History",
    state: {
      entries: ctx.history ?? [],
      loading: false,
      // Summed server-side from the same rows the list shows, so the ring and
      // the entries can never disagree.
      historyBreakdown: historyBreakdown(ctx.history),
    },
    actions: {
      // Called on mount + after a delete succeeds — a single source of truth
      // for "get the freshest list" keeps the UI honest.
      refresh: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "loading", value: true },
          {
            kind: "callEndpoint",
            method: "GET",
            path: "/v1/history",
            // Into a scratch key, then unwrap. The route answers
            // { entries, nextBefore, nextBeforeId } — assigning that straight
            // to `entries` made the list's items an OBJECT, Array.isArray said
            // no, and History rendered empty for everyone, every time, one
            // frame after the server-prefilled rows had appeared.
            assignTo: "_hist",
            onSuccess: "refreshDone",
            onError: "err",
          },
        ],
      },
      refreshDone: {
        kind: "sequence",
        actions: [
          // Unwrap the envelope into the key the list actually reads.
          { kind: "setState", path: "entries", value: "$state._hist.entries" },
          { kind: "setState", path: "loading", value: false },
        ],
      },
      // Tap on a card — detail view is intentionally deferred until we know
      // what belongs there beyond input/output/timestamp.
      openDetail: { kind: "toast", message: "@history.detail.toast", tone: "info" },
      // Long-press on a card — the row template resolves the entry id via a
      // "$item.id" placeholder that the renderer expands per row.
      deleteEntry: {
        kind: "sequence",
        actions: [
          {
            kind: "callEndpoint",
            method: "DELETE",
            path: "/v1/history/$state.item.id",
            onSuccess: "refresh",
            onError: "err",
          },
          { kind: "haptic", style: "success" },
        ],
      },
      err: { kind: "toast", message: "@history.delete.error", tone: "error" },
    },
    root: {
      type: "Screen",
      children: [
        ...screenHero("history"),
        {
          type: "Heading",
          props: { content: "@history.title" },
          style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 6 },
        },
        {
          type: "Paragraph",
          props: { content: "@history.subtitle" },
          style: { marginBottom: 20 },
        },
        { type: "ProgressBar", visibleIf: { truthy: "loading" } },
        // The ease, at the top. Words SPOKEN against words WRITTEN across the
        // entries below — the gap between the two is the work Tailzu did, which
        // is the only number on this screen the user did not produce themselves.
        // Hidden when there is nothing to summarise rather than drawing an
        // empty ring.
        {
          type: "Card",
          visibleIf: { truthy: "entries" },
          style: { marginBottom: 18 },
          children: [
            text("The ease", "label", { style: { marginBottom: 12 } }),
            {
              type: "DonutChart",
              bind: { data: "historyBreakdown" },
              props: {
                donut: true,
                size: 150,
                legend: "right",
                centerLabel: "words written",
              },
            },
          ],
        },
        {
          type: "List",
          bind: { items: "entries" },
          on: {
            onAppear: "refresh",
            onRefresh: "refresh",
          },
          props: {
            emptyLabel: "@history.empty",
            itemTemplate: {
              type: "Card",
              style: { marginBottom: 10 },
              on: {
                onPress: "openDetail",
                onLongPress: "deleteEntry",
              },
              children: [
                {
                  // Just when it happened. The app badge is gone: on iOS it
                  // could only ever say "Generic", because a keyboard
                  // extension cannot learn its host app — so it labelled every
                  // card with a word that meant nothing and looked like a
                  // category the user was supposed to understand.
                  //
                  // The time is formatted on the DEVICE. The server knows the
                  // instant but not the timezone, and a list that says 08:30
                  // to someone who dictated at 14:00 is worse than no time.
                  type: "Text",
                  bind: { content: "item.createdAt" },
                  props: { variant: "label", format: "relative" },
                },
                { type: "Spacer", style: { height: 10 } },
                // What was heard, then what was written. Labelled and in that
                // order, because the whole point of the pair is the difference
                // between them — unlabelled, the raw transcript reads as a
                // mistake rather than as the input.
                text("You said", "label", { style: { fontSize: 11, opacity: 0.6 } }),
                {
                  type: "Text",
                  bind: { content: "item.input" },
                  props: { variant: "muted", numberOfLines: 3 },
                },
                { type: "Spacer", style: { height: 10 } },
                // ACCENT_AMBER, not $color.primary — primary is WHITE in this
                // theme, so this label has been rendering the same colour as
                // the one above it and the pair read as one block.
                text("Tailzu wrote", "label", { style: { fontSize: 11, opacity: 0.9, color: ACCENT_AMBER } }),
                {
                  type: "Text",
                  bind: { content: "item.output" },
                  props: { variant: "body", numberOfLines: 6 },
                  style: { fontWeight: "600", color: "$color.text" },
                },
              ],
            },
          },
        },
      ],
    },
    cacheTtlSeconds: 45,
  };
}

/**
 * Onboarding is a server-driven, two-step flow (the language pick happens
 * BEFORE it, on the client's native post-auth language screen — see the
 * `needsLanguagePick` bootstrap flag):
 *   onboarding (voice permission) → onboarding_keyboard (enable keyboard) → home
 * The keyboard step saves `onboarded` to the profile, so completion is
 * remembered server-side (not just on the device).
 */

/**
 * Onboarding step 1 — the VOICE PERMISSION screen (screenId stays "onboarding"
 * so routing — pickInitialScreenId, the intro's `done`, cached clients — is
 * untouched).
 *
 * Why mic comes before the keyboard step: iOS only gives an app a per-app
 * Settings page AFTER at least one permission has been requested. The keyboard
 * step's "Open Settings" (app-settings:) needs that page to exist — granting
 * (or even just answering) the mic prompt here is what makes the next screen
 * able to open Settings DIRECTLY.
 *
 * Both outcomes advance to the keyboard step: denial isn't a dead end (the
 * user can still type with the keyboard; voice can be enabled later in
 * Settings → Tailzu). Fully backend-authored — copy/media/flow change OTA.
 */
function onboardingVoice(): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding",
    title: "",
    // Full-bleed: no header/back/tabs — this is the gate.
    hideChrome: true,
    // Both are overwritten live by the app, which re-reads the device on a
    // timer and on every return to the foreground. Declared with the
    // conservative answer so a store that has not been filled in yet routes
    // the long way round rather than skipping a step.
    state: { micGranted: false, keyboardReady: false },
    actions: {
      // ALREADY ALLOWED? DO NOT ASK AGAIN, AND DO NOT SIT THERE.
      //
      // Fired by the watcher at the foot of this screen, which is gated on
      // micGranted — so this runs when the permission is granted, whenever
      // that happens: already true when the screen opens, or turned on in
      // Settings and discovered the moment the app comes back.
      //
      // IT CANNOT BE DONE ON THE SCREEN APPEARING. The permission is changed
      // in Settings, which means the app was in the background when it
      // changed, and returning from the background is not a mount — the screen
      // that checked once on the way in never checks again, and sits there
      // asking for something it already has. That was the bug.
      //
      // The beat is deliberate. Passing instantly would flash this screen for
      // a frame and read as a glitch; a second and a half reads as the screen
      // noticing.
      autoPass: {
        kind: "sequence",
        actions: [
          { kind: "delay", ms: 1500 },
          // checkPermission, NOT requestPermission. Requesting is how you find
          // out, and on an undetermined permission the finding out IS the
          // prompt — which would fire the dialog on arrival, before this screen
          // had said a word. This reads the answer and never asks.
          { kind: "checkPermission", permission: "microphone", onGranted: "goKeyboard" },
        ],
      },

      // CTA — fire the system mic prompt. Either answer moves forward; the
      // permission REQUEST itself (not the grant) is what creates the per-app
      // Settings page the next screen deep-links to.
      allowMic: {
        kind: "requestPermission",
        permission: "microphone",
        onGranted: "goKeyboard",
        onDenied: "deniedNext",
        // ALREADY ANSWERED MEANS THE DIALOG IS NEVER COMING.
        //
        // iOS shows it once per install. After Don't Allow, or after the
        // switch is turned off in Settings later, this request returns denied
        // instantly and draws nothing — so the Allow button did visibly
        // nothing and read as broken rather than as a decision already made.
        //
        // Settings is the only place that answer can change, so that is where
        // this goes. The watcher at the foot of this screen is already looking
        // for the permission to appear, so coming back with it granted moves
        // the user on by itself.
        onBlocked: "micBlocked",
      },
      micBlocked: {
        kind: "sequence",
        actions: [
          { kind: "toast", tone: "info", message: "Turn on Microphone for Tailzu, then come back." },
          { kind: "openSettings", target: "app" },
        ],
      },
      // Forward from here means the NEXT thing still missing — not always the
      // keyboard step. Someone whose keyboard is already set up (a second
      // account on the same phone, mic denied but everything else in place)
      // would otherwise land on a walkthrough for something already done and
      // watch it dismiss itself.
      goKeyboard: {
        kind: "condition",
        if: { truthy: "keyboardReady" },
        then: "finishOnboarding",
        // replace, not push: onboarding is a sequence, and an edge swipe must
        // not walk back into a permission screen that has been answered.
        else: { kind: "navigate", screenId: "onboarding_keyboard", replace: true },
      },
      // Same finish the keyboard step performs, for the case where that step
      // is skipped. Errors land the user in the app anyway: the flag is worth
      // one retry next launch, not a dead end on a screen with nothing to do.
      finishOnboarding: {
        kind: "callEndpoint",
        method: "PUT",
        path: "/v1/profile",
        body: { onboarded: true },
        onSuccess: "landInApp",
        onError: "landInApp",
      },
      landInApp: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          { kind: "switchTab", tabId: "personality" },
        ],
      },
      deniedNext: {
        kind: "sequence",
        actions: [
          { kind: "toast", tone: "info", message: "You can allow the microphone anytime in Settings → Tailzu." },
          { kind: "navigate", screenId: "onboarding_keyboard", replace: true },
        ],
      },
    },
    root: {
      type: "Stack",
      // hideChrome = truly full-bleed, so the top/bottom padding IS the safe
      // area: 76 clears the status bar on notch phones, 48 clears the home
      // indicator (28/28 put the title under the clock and clipped "Not now").
      style: {
        flex: 1,
        direction: "column",
        alignItems: "center",
        backgroundColor: "#000000",
        paddingHorizontal: 28,
        paddingTop: 76,
        paddingBottom: 48,
      },
      // GOLDEN SCALE (φ ≈ 1.618, via the Fibonacci ladder 8·13·21·34·55):
      // type pairs size×φ≈lineHeight — 34/42 display (display tracks tighter),
      // 21/34 pitch, 14/23 body, 13/21 sub, 11 kicker; spacing steps come from
      // the same ladder (13, 21, 34, 55). One ratio everywhere is what makes
      // the screen read composed instead of arbitrary.
      children: [
        // TWO HEADINGS, ONE SENTENCE. A Text paints one colour, so the last
        // word cannot carry the brand while the rest stays white — the sentence
        // has to be split to be two-toned. Both halves are Headings rather than
        // Texts so the serif family and tracking come from the same place they
        // always did, and only the colour differs.
        //
        // Row wraps, so a narrow screen breaks between the two halves — a clean
        // break after "It's" — instead of clipping. flexWrap needs a width to
        // wrap within, hence 100%.
        {
          type: "Stack",
          style: {
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "flex-end",
            width: "100%",
          },
          children: [
            {
              type: "Heading",
              props: { content: "Say it. It's " },
              style: { fontSize: 34, lineHeight: 42, color: "$color.text", marginBottom: 0 },
            },
            {
              type: "Heading",
              props: { content: "written." },
              style: { fontSize: 34, lineHeight: 42, color: ACCENT_AMBER, marginBottom: 0 },
            },
          ],
        },
        // The vertical middle. Swappable: upload onboarding.hero, or set
        // HERO_ONBOARDING to an SDUI node, and this becomes that instead.
        {
          type: "Stack",
          style: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
          children: [heroSlot({
            id: "onboarding",
            mediaKeys: ["onboarding.hero"],
            style: { width: HERO_PARTICLE, height: HERO_PARTICLE, borderRadius: HERO_PARTICLE / 2 },
            builtIn: {
              // The mark comes apart in vacuum, holds, and springs back
              // together. This screen is asking for the microphone, so the
              // most honest illustration is the motion the microphone makes.
              type: "ParticleMark",
              props: {
                count: 160,
                dotRadius: 1.5,
                color: THEME.color.primary,
                speed: 1,
                circular: true,
                holdMark: true,
              },
              // Older bundles have no ParticleMark and would leave the middle
              // of the screen empty.
              fallback: {
                type: "Paragraph",
                props: { content: "Talk like you talk. It comes out clean, and still sounds like you." },
                style: { textAlign: "center", fontSize: 21, lineHeight: 34, fontWeight: "300", color: "$color.text", maxWidth: 300 },
              },
            },
          })],
        },
        {
          type: "Paragraph",
          props: { content: "The mic is what makes that possible — in every app you type in." },
          style: { textAlign: "center", fontSize: 13, lineHeight: 21, marginBottom: 21 },
        },
        // ONE CONTROL, TWO ANSWERS. The dark pill is the whole width of the
        // thing and the way past is a ✕ — because these are not two equal
        // offers. One of them is the microphone the product runs on.
        allowPill("Allow access", "allowMic", "goKeyboard"),
        // THE WATCHER. Draws nothing; exists to notice.
        //
        // visibleIf + onAppear means "run this when the condition becomes
        // true", and micGranted is re-read on every return to the foreground —
        // so this fires whether the permission was already there when the
        // screen opened or was granted in Settings a minute later.
        { type: "Stack", style: { height: 0 },
          visibleIf: { truthy: "micGranted" },
          on: { onAppear: "autoPass" } },
      ],
    },
    cacheTtlSeconds: 600,
  };
}

/** Step 2 — enable the Tailzu keyboard, then finish (marks onboarded). */
function onboardingKeyboard(): ScreenResponse {
  // Golden body pair: 14/23 (14 × φ ≈ 22.65) — see the voice screen's scale note.
  const step = (n: string, body: string): Node => ({
    type: "Stack", style: { direction: "row", gap: 10, alignItems: "flex-start" }, children: [
      // Fixed-width number column so all five step bodies left-align.
      { type: "Text", props: { content: n }, style: { color: "$color.muted", fontSize: 10.5, fontWeight: "700", width: 12, lineHeight: 16 } },
      { type: "Paragraph", props: { content: body }, style: { marginBottom: 0, flex: 1, fontSize: 11.5, lineHeight: 16 } },
    ],
  });
  // The line that used to sit under the headline, now the box's own first
  // line. It belongs here: it is not a second thought after the title, it is
  // what the list under it is for.
  const stepsTitle: Node = {
    type: "Paragraph",
    props: { content: "A moment in Settings, and Tailzu writes with you in every app." },
    style: { fontSize: 12.5, lineHeight: 18, color: "$color.text", marginBottom: 11 },
  };
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding_keyboard",
    title: "",
    // Full-bleed like the voice step: without this the tab bar + back chevron
    // render, and a user who taps Home escapes onboarding WITHOUT the
    // finish/skip PUT — profile.onboarded stays false and every next launch
    // routes back into onboarding (the "voice screen forever" loop).
    hideChrome: true,
    state: { keyboardReady: false, keyboardEnabled: false },
    actions: {
      // No staged flash any more. It existed because the old Button's own
      // amber decay was racing iOS — the next action handed the screen to
      // Settings before the colour read. The pill is a Stack with an onPress,
      // which is a Pressable, and its dim-on-press lands the instant the
      // finger does: immediate feedback, and nothing between the tap and the
      // door opening.
      // MOVE ON BY ITSELF once the keyboard is actually enabled.
      //
      // The app polls the keyboard's status every 1.5s and on every return to
      // foreground, so keyboardReady flips true moments after the user finishes
      // in Settings and comes back. This fires on that flip (see the watcher
      // node at the foot of the screen) and finishes onboarding for them —
      // there is nothing left to ask, and asking them to tap a button that
      // says the thing they just did is a step for its own sake.
      //
      // The beat before it is the point: land back in the app, see the screen
      // acknowledge the change, and then move. Passing instantly would look
      // like a dropped frame rather than a result.
      autoFinish: {
        kind: "sequence",
        actions: [{ kind: "delay", ms: 1100 }, "finish"],
      },
      // Prefer openUrl("app-settings:") over openSettings — same underlying
      // iOS mechanism but a different Linking code path. Critically, this
      // action only reliably opens iOS Settings AFTER at least one permission
      // has been requested — before that, iOS has no per-app Settings surface
      // and the URL resolves silently. The VOICE PERMISSION screen right
      // before this one fires that prompt, so Settings opens DIRECTLY here.
      // The leading requestPermission is an idempotent belt-and-suspenders for
      // the "Not now" path (already-decided permissions return instantly with
      // no prompt).
      openSettings: {
        kind: "sequence",
        actions: [
          { kind: "requestPermission", permission: "microphone" },
          { kind: "openUrl", url: "app-settings:", external: true },
          { kind: "toast", tone: "info", message: "In Settings: General → Keyboard → Keyboards → Add New → Tailzu" },
        ],
      },
      // Android lands the user ON the keyboard list. `openSettings` with
      // target "keyboard" fires INPUT_METHOD_SETTINGS, so none of the walk
      // above applies — and app-settings: is an iOS URL scheme that does
      // nothing here, which is why this cannot share the action.
      openKeyboardSettings: {
        kind: "sequence",
        actions: [
          { kind: "openSettings", target: "keyboard" },
          { kind: "toast", tone: "info", message: "Turn on Tailzu, then come back." },
        ],
      },
      // Split the finish flow so `switchTab` only runs after the PUT succeeds.
      // Previously the write was fire-and-forget: any network blip / 401 / 5xx
      // was swallowed and the user still visually "completed" onboarding,
      // producing the "home tab + onboarding content" loop on next launch.
      finish: {
        kind: "callEndpoint",
        method: "PUT",
        path: "/v1/profile",
        body: { onboarded: true },
        onSuccess: "finishOk",
        onError: "finishErr",
      },
      finishOk: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          // Land on You: profileGate.screenIds = ["personality"], so the
          // name/gender card is the immediate next step. Landing on Home
          // silently deferred it until the user happened to open You.
          { kind: "switchTab", tabId: "personality" },
        ],
      },
      finishErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't finish setup. Check your connection and try again.",
      },
      // Escape hatch — user can skip onboarding even if `keyboardReady` never
      // flips true (e.g. the iOS keyboard extension isn't installed on this
      // build, or Full Access can't be detected). Same server confirmation as
      // finish, so the flag actually persists.
      skip: {
        kind: "callEndpoint",
        method: "PUT",
        path: "/v1/profile",
        body: { onboarded: true },
        onSuccess: "finishOk",
        onError: "finishErr",
      },
    },
    // A ROOT, NOT A TEMPLATE — because of the backdrop.
    //
    // "scroll" composes exactly one node, a Screen, so a template leaves
    // nowhere to put a layer BEHIND the content: anything added to blocks is
    // inside the ScrollView, where an absolute child anchors to the content
    // box and scrolls away with it. A backdrop has to be the Screen's sibling
    // to stay still and to fill the window, and that needs a root.
    //
    // The Screen is transparent so the art shows through, and the Stack under
    // both stays black — that is what is seen before the media loads, and if
    // nothing has been uploaded to the key it is all that is ever seen. Safe
    // to ship ahead of the art.
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: "#000000" },
      children: [
        // Upload to `onboarding_keyboard.bg` and it appears; upload nothing and
        // screenHero returns no nodes at all. Video or still, either works.
        ...screenHero("onboarding_keyboard.bg", { behind: true }),
        {
          type: "Screen",
          style: { backgroundColor: "transparent" },
          children: [
      // hideChrome = full-bleed: this spacer IS the top safe area (the card
      // used to start under the status-bar clock). Golden ladder throughout —
      // 13/21/34/55 spacing, 34/42 heading, 12.5/18 box title, 11.5/16 steps.
      { type: "Spacer", style: { height: 66 } },
      // 34/42, the display size off the same golden ladder the voice step uses.
      // With the supporting line moved into the box below, the headline is the
      // only thing at the top of the screen and should read like it.
      { type: "Heading", props: { content: "Bring it everywhere." },
        style: { fontSize: 34, lineHeight: 42, color: "$color.text", marginBottom: 21 } },
      // The walk through Settings, shown rather than described — and one
      // recording per platform, because the two walks share no screen. An iOS
      // recording shown to an Android user is worse than no recording: it
      // teaches them a path that does not exist on their phone.
      //
      // Gated on the device, like the written steps below. Upload a video or
      // a GIF to either key; upload nothing and that platform simply shows
      // the words, so this is safe to ship before the art exists.
      //
      // Portrait, because a recording of a phone screen IS portrait: 9:16 at
      // 200pt wide, centred. Forcing that into a landscape banner would crop
      // it to a sliver of itself. The screen scrolls, so the height is
      // affordable and the steps still sit under it.
      ...screenHero("onboarding_keyboard.ios", { height: 356, width: 200, radius: 18, onlyOn: "ios" }),
      ...screenHero("onboarding_keyboard.android", { height: 356, width: 200, radius: 18, onlyOn: "android" }),
      // The steps card, per platform. The two systems share nothing here:
      // "General", "Add New Keyboard" and "Allow Full Access" do not exist on
      // Android, and Android's own path is shorter because the button below
      // deep-links straight to its keyboard settings.
      //
      // Both lists ship and the device picks — the renderer's `platform`
      // condition is evaluated on the phone, so this needs no server-side
      // detection and cannot get it wrong.
      //
      // iOS. Apple does NOT allow deep-linking into Settings > Keyboards, so
      // the button lands on Tailzu's own Settings page (which exists because
      // the voice step just fired the mic prompt) and the user walks the rest.
      // Every step is spelled out because none of them can be skipped for them.
      {
        type: "Card",
        visibleIf: { platform: "ios" },
        // Brand border. The steps ARE the screen — the button only opens a
        // door — so the card is what the eye should land on, and an amber
        // hairline says that without a fill loud enough to fight the headline.
        style: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: ACCENT_AMBER },
        children: [
          stepsTitle,
          step("1", "Open Settings, then tap General."),
          { type: "Spacer", style: { height: 10 } },
          step("2", "Tap Keyboard → Keyboards → Add New Keyboard."),
          { type: "Spacer", style: { height: 10 } },
          step("3", "Choose Tailzu from the list."),
          { type: "Spacer", style: { height: 10 } },
          step("4", "Tap Tailzu again and turn on “Allow Full Access”."),
          { type: "Spacer", style: { height: 10 } },
          step("5", "Return to Tailzu — the globe key switches keyboards."),
        ],
      },
      // Android. The button fires INPUT_METHOD_SETTINGS, which opens the
      // keyboard list directly — so the walk through Settings that iOS needs
      // is replaced by one tap, and the steps start from where the user
      // lands. Step 3 is the notice Android shows about keyboards reading what
      // you type; it looks alarming and it is what stops people, so it is
      // named rather than left as a surprise. There is no Full Access on
      // Android, and no step for it.
      {
        type: "Card",
        visibleIf: { platform: "android" },
        style: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: ACCENT_AMBER },
        children: [
          stepsTitle,
          step("1", "Tap the button below — it opens your keyboard list."),
          { type: "Spacer", style: { height: 10 } },
          step("2", "Turn on Tailzu."),
          { type: "Spacer", style: { height: 10 } },
          step("3", "Android warns that a keyboard can read what you type. Accept it — that is how every keyboard works."),
          { type: "Spacer", style: { height: 10 } },
          step("4", "Come back, then tap the globe key to switch to Tailzu."),
        ],
      },
      { type: "Spacer", style: { height: 34 } },
      // Two buttons, one per platform, because they go to different places and
      // a label should say where. iOS lands on Tailzu's own Settings page and
      // the user walks from there — "Go to Settings" is the honest promise.
      // Android lands directly on the keyboard list, so it can promise that.
      // iOS lands on Tailzu's own Settings page and the user walks from there;
      // Android lands directly on the keyboard list. Same control, different
      // promise, because a label should say where it goes.
      {
        ...allowPill("Allow access", "openSettings", "skip"),
        visibleIf: { all: [{ not: { truthy: "keyboardEnabled" } }, { platform: "ios" }] },
      },
      {
        ...allowPill("Allow access", "openKeyboardSettings", "skip"),
        visibleIf: { all: [{ not: { truthy: "keyboardEnabled" } }, { platform: "android" }] },
      },
      // Already done. No ✕ — there is nothing left to decline.
      {
        ...allowPill("Start using Tailzu", "finish"),
        visibleIf: { truthy: "keyboardEnabled" },
      },
      { type: "Spacer", style: { height: 55 } },
      // THE WATCHER. Draws nothing; exists to notice.
      //
      // visibleIf + onAppear means "run this when the condition becomes true",
      // so this fires the moment the signal flips — which is the moment the app
      // comes back from Settings with the keyboard turned on.
      //
      // keyboardEnabled, NOT keyboardReady. Full Access is readable only from
      // inside the keyboard extension, and ADDING A KEYBOARD DOES NOT RUN IT —
      // so keyboardReady stays false until the user happens to type with it
      // somewhere, and a screen waiting on that waits forever. `enabled` comes
      // from the system's own list of keyboards and turns true as soon as
      // Tailzu is switched on, which is when this step has nothing left to ask.
      //
      // A Stack, not a Spacer: Spacer reads height 0 as "no height given" and
      // takes flex: 1, which pushes the rest of the screen apart.
      { type: "Stack", style: { height: 0 },
        visibleIf: { truthy: "keyboardEnabled" },
        on: { onAppear: "autoFinish" } },
          ],
        },
      ],
    },
    cacheTtlSeconds: 600,
  };
}

/**
 * The main app's landing screen when the keyboard extension hands off a
 * mic tap. `params.session` (from the deep link) is threaded into
 * state.handoffSessionId so the completeKeyboardHandoff action knows which
 * session to write back to the App Group.
 *
 * The user sees the recording UI, speaks, and taps Send — the SDUI
 * VoiceToggle already records + uploads to /v1/transcribe-clean and puts
 * the cleaned text in state.dictationSample. Send fires
 * completeKeyboardHandoff, which writes the text to the App Group +
 * fires a Darwin notification the keyboard observes to insert.
 *
 * Fully backend-designed: swap the media, copy, layout, any which way,
 * without a rebuild. Add hero art, a Lottie, whatever — it's just SDUI.
 */
function keyboardRecordScreen(ctx: ScreenContext): ScreenResponse {
  const sessionId = String(ctx.params?.session ?? "");
  const hostApp = String(ctx.params?.host ?? "");
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "keyboard_record",
    title: "",
    state: {
      handoffSessionId: sessionId,
      hostApp,
      dictationSample: "",
      sending: false,
    },
    actions: {
      // Fired by VoiceToggle when transcription fails.
      err: { kind: "toast", tone: "error", message: "Voice failed. Check your connection." },
      // Called by the Send button — writes the text back through the native
      // module and shows a "swipe back" hint. Backend can localize the toast
      // or swap it for a full-screen "Sent" card by editing this action.
      send: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "sending", value: true },
          { kind: "completeKeyboardHandoff" },
          { kind: "haptic", style: "success" },
          { kind: "toast", tone: "success", message: "Sent to Tailzu keyboard — swipe back to your app." },
        ],
      },
      // User bailed — cancel the pending handoff so the keyboard doesn't
      // sit in "listening" forever.
      cancel: {
        kind: "sequence",
        actions: [
          { kind: "cancelKeyboardHandoff" },
          { kind: "navigateBack" },
        ],
      },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 20, paddingTop: 40, paddingBottom: 24 },
      children: [
        { type: "Overline", props: { content: "Voice keyboard" } },
        { type: "Heading", props: { content: "Speak, then swipe back" }, style: { fontSize: 26, fontWeight: "800", color: "$color.text", marginTop: 6, marginBottom: 6 } },
        { type: "Paragraph", props: { content: "We'll clean it up and drop the text into your keyboard. Nothing gets sent from here — the keyboard inserts it into whatever app you were in." }, style: { marginBottom: 28 } },
        // Big centered mic. VoiceToggle handles record → upload →
        // dictationSample.
        //
        // Media on the mic:
        //   iconIdle       — media for the idle (not-recording) state
        //   iconRecording  — media for the recording state
        //
        // Each accepts EITHER the simple shape:
        //     { key: "mic.idle" }                             ← MediaSpec
        // OR the rich playback shape:
        //     {
        //       source: { key: "mic.recording" },             ← required
        //       autoplay: true,                                ← play on show
        //       loop: true,                                    ← loop forever
        //       speed: 1.0,                                    ← Lottie / video
        //       muted: true,                                   ← video (default)
        //       maxDurationMs: 4000,                           ← hard cap
        //       tint: "#FFCC00",                               ← PNG tint
        //       playing: true,                                 ← controlled play
        //       fireOnEnd: true,                               ← ⇢ node.onComplete
        //     }
        //
        // When fireOnEnd is true, the VoiceToggle's onComplete NodeEvent
        // fires when the media's playback ends (natural end OR after
        // maxDurationMs). Wire an SDUI action in `on.onComplete` on the
        // VoiceToggle node to react — the payload is
        // { state: "idle" | "recording" } so one action can handle both.
        //
        // Supported source formats (auto-detected):
        //   PNG · JPG · WebP · SVG · GIF · APNG · Lottie JSON · MP4 / MOV / WebM
        //
        // Uploading:
        //   POST /v1/media/upload?key=mic.idle       (any of the above)
        //   POST /v1/media/upload?key=mic.recording  (any of the above)
        //
        // Missing keys fall back to the built-in Tailzu-mark → line morph,
        // so a fresh deploy without uploaded assets still works.
        { type: "Stack", style: { alignItems: "center", justifyContent: "center", marginBottom: 20 }, children: [
          {
            type: "VoiceToggle",
            bind: { value: "dictationSample" },
            props: {
              targetApp: hostApp || "Generic",
              language: "auto",
              size: 128,
              autoStart: true,
              // Backend-owned mic art with full playback control.
              //
              // Single-media mode: supply ONLY iconIdle → the mic uses the
              // same asset in both states and the client auto-binds `playing`
              // to the recording state. tap → play, tap → pause (holds the
              // current frame), tap → resume from that frame. Works for
              // Lottie + video; GIF/APNG can't pause so the visual just
              // keeps looping while recording state does its own thing.
              //
              // Two-media mode: also supply iconRecording → the two swap on
              // state change (see the commented block below to re-enable).
              //
              // Voice-reactive playback:
              //   voiceReactive:true → media speed is driven by mic level
              //                         while recording (loud → fast, quiet
              //                         → slow). Amplitude-based, not
              //                         fundamental-pitch, but visually
              //                         reads the same.
              //   speedRange:[a,b]   → min/max playback multiplier
              //   levelRange:[a,b]   → dB window mapped into speedRange
              //   speedSmoothing:0..1 → higher = laggier attack/release
              //
              //   NOTE: only Lottie + MP4 can be retimed at runtime. GIF/APNG
              //   ignore live speed changes and keep their baked-in rate.
              iconIdle: {
                source: { key: "mic.animation" },
                loop: true,
                speed: 1,
                muted: true,
                voiceReactive: true,
                speedRange: [0.5, 2.5],
                levelRange: [-45, -5],
                speedSmoothing: 0.7,
              },
              // iconRecording: { source: { key: "mic.recording" }, loop: true },
              background: "#ffffff",
              contentScale: 0.72,
            },
            on: { onError: "err" },
            fallback: {
              type: "VoiceButton",
              bind: { value: "dictationSample" },
              props: { targetApp: hostApp || "Generic", language: "auto" },
              on: { onError: "err" },
            },
          },
        ] },
        // Live transcription preview so the user can trust what's being sent.
        { type: "Card", style: { marginBottom: 20 }, children: [
          { type: "Paragraph", visibleIf: { falsy: "dictationSample" }, props: { content: "Tap the mic to start. Tap again to stop." }, style: { color: "$color.muted" } },
          { type: "TextField", visibleIf: { truthy: "dictationSample" }, bind: { value: "dictationSample" }, props: { multiline: true } },
        ] },
        // Send + Cancel row.
        { type: "Button", visibleIf: { truthy: "dictationSample" }, props: { label: "Send to keyboard", variant: "primary" }, on: { onPress: "send" } },
        { type: "Spacer", style: { height: 10 } },
        { type: "Button", props: { label: "Cancel", variant: "secondary" }, on: { onPress: "cancel" } },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

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

function flowArmScreen(_ctx: ScreenContext): ScreenResponse {
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
          { kind: "navigate", screenId: "home" },
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
          { kind: "navigate", screenId: "home" },
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

/**
 * Cold-start primer — shown the FIRST time the keyboard hands off before
 * the main app has been foregrounded (or after a long absence). We can't
 * record right away because iOS hasn't granted mic yet; instead we prompt
 * the user, then tell them to swipe back and re-tap the keyboard mic.
 *
 * On subsequent handoffs the main app will be warm and go straight to
 * keyboard_record. Same backend-owned design freedom as everything else.
 */
function keyboardPrimerScreen(ctx: ScreenContext): ScreenResponse {
  const sessionId = String(ctx.params?.session ?? "");
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "keyboard_primer",
    title: "",
    state: { handoffSessionId: sessionId, micGranted: false },
    actions: {
      grantMic: {
        kind: "requestPermission",
        permission: "microphone",
        onGranted: "granted",
        onDenied: "denied",
      },
      granted: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "micGranted", value: true },
          { kind: "haptic", style: "success" },
        ],
      },
      denied: {
        kind: "toast",
        tone: "error",
        message: "Allow the microphone in Settings → Tailzu, then swipe back and tap the keyboard mic again.",
      },
      openMainSettings: {
        kind: "openSettings",
      },
      dismiss: {
        kind: "sequence",
        actions: [
          { kind: "cancelKeyboardHandoff" },
          { kind: "navigateBack" },
        ],
      },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 24 },
      children: [
        { type: "Overline", props: { content: "One-time setup" } },
        { type: "Heading", props: { content: "Turn on voice for the keyboard" }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginTop: 6, marginBottom: 12 } },
        { type: "Paragraph", props: { content: "iOS requires this app to grant microphone access before the keyboard can use it. Tap Allow, then swipe back to your app — the keyboard mic will work from then on." }, style: { marginBottom: 28 } },
        { type: "Card", style: { marginBottom: 22, padding: 16 }, children: [
          { type: "Stack", style: { flexDirection: "row", alignItems: "center", marginBottom: 10 }, children: [
            { type: "Text", props: { content: "1." }, style: { fontSize: 15, fontWeight: "800", color: "$color.primary", width: 24 } },
            { type: "Text", props: { content: "Tap the Allow mic button below" }, style: { fontSize: 15, color: "$color.text", flex: 1 } },
          ] },
          { type: "Stack", style: { flexDirection: "row", alignItems: "center", marginBottom: 10 }, children: [
            { type: "Text", props: { content: "2." }, style: { fontSize: 15, fontWeight: "800", color: "$color.primary", width: 24 } },
            { type: "Text", props: { content: "Approve the iOS microphone prompt" }, style: { fontSize: 15, color: "$color.text", flex: 1 } },
          ] },
          { type: "Stack", style: { flexDirection: "row", alignItems: "center" }, children: [
            { type: "Text", props: { content: "3." }, style: { fontSize: 15, fontWeight: "800", color: "$color.primary", width: 24 } },
            { type: "Text", props: { content: "Swipe back to your app and tap the keyboard mic again" }, style: { fontSize: 15, color: "$color.text", flex: 1 } },
          ] },
        ] },
        {
          type: "Button",
          visibleIf: { not: { truthy: "micGranted" } },
          props: { label: "Allow microphone", variant: "primary" },
          on: { onPress: "grantMic" },
        },
        {
          type: "Card",
          visibleIf: { truthy: "micGranted" },
          motion: { appear: "fadeInUp" },
          style: { padding: 16, marginBottom: 12 },
          children: [
            { type: "Heading", props: { content: "You're set" }, style: { fontSize: 18, fontWeight: "800", color: "$color.text", marginBottom: 6 } },
            { type: "Paragraph", props: { content: "Swipe back to your app now and tap the keyboard mic. It'll work from here on out." } },
          ],
        },
        { type: "Spacer", style: { height: 10 } },
        {
          type: "Button",
          visibleIf: { not: { truthy: "micGranted" } },
          props: { label: "Open Tailzu Settings", variant: "secondary" },
          on: { onPress: "openMainSettings" },
        },
        { type: "Spacer", style: { height: 8 } },
        {
          type: "Button",
          props: { label: "Cancel", variant: "secondary" },
          on: { onPress: "dismiss" },
        },
      ],
    },
    cacheTtlSeconds: 600,
  };
}


/**
 * Haptics picker — the three keyboard layouts, exactly as they are laid out on
 * the keyboard, with every key tappable.
 *
 * Selection is SERVER state, not client state. Each tap posts one key and the
 * screen refreshes, so what you see is always what the keyboard will do. The
 * alternative — mirroring the set locally and syncing later — is how a settings
 * screen ends up disagreeing with the thing it configures.
 *
 * The master toggle and the individual keys stay INDEPENDENT. Turning "all keys"
 * off must not discard the keys someone picked one by one, and the toggle reads
 * as on whenever either is true, because in both cases keys are buzzing.
 */
/**
 * How the haptics screen draws its keyboards.
 *
 * Every value here was a constant inside KeyboardPreview. They are here now
 * because this screen's entire job is showing the keyboard, and a picture of a
 * keyboard that cannot be changed without a build is a picture that goes stale
 * the moment the real one is restyled.
 */
const HAPTICS_UI = {
  keyHeight: 42,
  gap: 6,
  radius: 5,
  accent: ACCENT_AMBER,
  /** Unlit ordinary key, and unlit function key. */
  keyFill: "#FFFFFF8C",
  fnFill: "#FFFFFF26",
  /** Label on a lit key, an ordinary key, a function key. */
  litLabel: "#000000",
  keyLabel: "#111114",
  fnLabel: "#FFFFFF",
  fontSize: 17,
  longFontSize: 13,
  /** How the reels behave. Paging, because a keyboard resting half off the
   *  bottom has a bottom row nobody can reach. */
  paging: true,
  align: "center",
};

function hapticsScreen(ctx: ScreenContext): ScreenResponse {
  const kb = HAPTICS_UI;
  const chosen = (ctx.personality?.hapticKeys ?? []).map((k) => String(k).toLowerCase());
  const all = ctx.personality?.hapticsAll === true;

  // The picker IS the keyboard. It is drawn by KeyboardPreview, one component
  // whose job is keyboards — the first attempt composed it from Button nodes
  // and came out as a field of pills with the labels clipped, because a
  // keyboard is a grid with its own sizing rules and not a row of small
  // buttons.
  //
  // Rows come from KB_ROW_*, which the KEYBOARD is also built from, so adding
  // a key there makes it appear here with nothing else to change.
  type PK = { label: string; id: string; flex?: number; w?: number; fn?: boolean; spacer?: boolean };
  const k = (label: string, id?: string, extra: Partial<PK> = {}): PK =>
    ({ label, id: id ?? label, ...extra });
  const chars = (list: string[]): PK[] => list.map((c) => k(c, c));
  const spacer = (flex: number): PK => ({ label: "", id: "", flex, spacer: true });

  // Identical on every layer bar its leftmost key — as on the real keyboard.
  const bottom = (leftLabel: string, leftId: string): PK[] => [
    k(leftLabel, leftId, { flex: 2.4, fn: true }),
    k(".", ".", { flex: 1.29, fn: true }),
    k("space", "space", { flex: 5.2 }),
    k("@", "@", { flex: 1.29, fn: true }),
    k("return", "return", { flex: 2.4, fn: true }),
  ];

  /**
   * ONE KEYBOARD PER REEL, and no name on it.
   *
   * Four keyboards will not fit on a screen at once, and the old answer —
   * stack them and scroll — left a keyboard resting half off the bottom with
   * its last row unreachable, which on a screen whose whole job is tapping
   * individual keys is not a cosmetic problem. So each layer gets the window
   * to itself and you move between them the way you move between reels.
   *
   * No title. "Letters", "Numbers", "Symbols" name what is already drawn full
   * size underneath them, and four labels down a screen of four keyboards
   * read as chapter headings on a book with one word per chapter.
   */
  const board = (rows: PK[][]): Node => ({
    type: "Stack",
    style: { paddingHorizontal: 12 },
    children: [
      {
        type: "KeyboardPreview",
        // THE WHOLE LOOK, from here. These were constants in the component,
        // which meant the screen that exists to show what the keyboard looks
        // like could only be restyled with a build — and would therefore
        // disagree with the real keyboard the first time that changed.
        props: {
          rows, selected: chosen, all,
          keyHeight: kb.keyHeight,
          gap: kb.gap,
          radius: kb.radius,
          accent: kb.accent,
          keyFill: kb.keyFill,
          fnFill: kb.fnFill,
          litLabel: kb.litLabel,
          keyLabel: kb.keyLabel,
          fnLabel: kb.fnLabel,
          fontSize: kb.fontSize,
          longFontSize: kb.longFontSize,
        },
        // A client without this component renders node.fallback — and without
        // one, renders NOTHING, which is how this screen came back as four
        // empty cards. Any node the backend adds ahead of the app that draws
        // it needs this; the master switch above still works meanwhile, so the
        // screen degrades to "less precise" rather than "broken".
        fallback: {
          type: "Paragraph",
          props: { content: "Update Tailzu to choose keys one by one. \u201cEvery key\u201d above works either way." },
          style: { fontSize: 13, color: "$color.muted" },
        },
        // $event is the key's id — the component fires it, so one handler
        // serves every key instead of one action per key baked into the tree.
        on: { onPress: { kind: "sequence", actions: [
          { kind: "haptic", style: "selection" },
          { kind: "callEndpoint", method: "POST", path: "/v1/personality/haptics",
            body: { key: "$event" }, onError: "err" },
          { kind: "refresh" },
        ] } },
      },
    ],
  });

  /** The four layers, in the order the keyboard itself moves between them. */
  const boards: Node[] = [
    board([
      chars(KB_ROW_LETTERS_1),
      [spacer(0.5), ...chars(KB_ROW_LETTERS_2), spacer(0.5)],
      [
        k("⇧", "shift", { flex: 1.35, fn: true }),
        spacer(0.22),
        ...chars(KB_ROW_LETTERS_3),
        spacer(0.22),
        k("⌫", "backspace", { flex: 1.35, fn: true }),
      ],
      bottom("123", "123"),
    ]),
    board([
      chars(KB_ROW_NUM_1),
      chars(KB_ROW_NUM_2),
      [
        k("#+=", "#+=", { flex: 1.5, fn: true }),
        ...chars(KB_ROW_PUNCT_3),
        k("⌫", "backspace", { flex: 1.5, fn: true }),
      ],
      bottom("ABC", "abc"),
    ]),
    board([
      chars(KB_ROW_SYM_1),
      chars(KB_ROW_SYM_2),
      [
        k("123", "123", { flex: 1.5, fn: true }),
        ...chars(KB_ROW_PUNCT_3),
        k("⌫", "backspace", { flex: 1.5, fn: true }),
      ],
      bottom("ABC", "abc"),
    ]),
    board([[
      k("mic", "mic", { fn: true }),
      k("Refine", "refine", { fn: true }),
      k("globe", "globe", { fn: true }),
    ]]),
  ];

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "haptics",
    title: "Haptics",
    // Seeded from the saved setting so the switch is right the instant the
    // screen draws, and mutated in place by the switch after that.
    state: { hapticsAll: all },
    actions: {
      // The ONLY place this screen refetches. Every tap is applied locally the
      // moment it happens; a failure is the one time the server disagrees with
      // what the user is looking at, and then the screen has to go and find out
      // what is true rather than leave a key lit that is not.
      err: { kind: "sequence", actions: [
        { kind: "toast", message: "Couldn't save that.", tone: "error" },
        { kind: "refresh" },
      ] },
    },
    // The amber block reaches the top of the window, so the app's own header
    // has to go. The block carries the way back in its place.
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        // The kicker carries what the switch does, so the switch itself needs
        // no label beside it. One sentence at the top of the screen beats the
        // same word repeated next to a control on every layer.
        youHead("Tap a key. Or switch them all on.", "Haptics"),
        {
          // THE SWITCH DOES NOT SCROLL. It belongs to all four layers, and a
          // control that scrolls away with the one it happens to sit on reads
          // as belonging to that one. So it is a SIBLING of the pager, below
          // the amber and above the keyboards, and it stays where it is put.
          //
          // It wears the brand colour when on, not the system green: a colour
          // Apple drew, on a control Apple did not, reads as borrowed.
          type: "Stack",
          style: {
            flexDirection: "row", alignItems: "center", justifyContent: "flex-end",
            paddingHorizontal: YOU_UI.padding, paddingTop: 14, paddingBottom: 6,
          },
          children: [
            {
              type: "Switch",
              bind: { value: "hapticsAll" },
              // The switch writes the new value to state BEFORE this fires, so
              // the body reads it rather than negating the old one — no second
              // source of truth to drift.
              on: { onChange: { kind: "sequence", actions: [
                { kind: "haptic", style: "selection" },
                { kind: "callEndpoint", method: "POST", path: "/v1/personality/haptics",
                  body: { all: "$state.hapticsAll" }, onError: "err" },
                { kind: "refresh" },
              ] } },
              // Older bundles keep the row they already know how to draw. That
              // one carries a label, because a bare Row would be a blank line.
              fallback: {
                type: "Row",
                props: { label: "Every key", value: all ? "On" : "Off" },
                on: { onPress: { kind: "sequence", actions: [
                  { kind: "haptic", style: "selection" },
                  { kind: "callEndpoint", method: "POST", path: "/v1/personality/haptics",
                    body: { all: !all }, onError: "err" },
                  { kind: "refresh" },
                ] } },
              },
            },
          ],
        },
        {
          type: "Reels",
          props: { paging: kb.paging, align: kb.align },
          style: { flex: 1 },
          children: boards,
          // A bundle without Reels gets the four boards down a scroll. Less
          // precise, entirely usable, and the switch above still works — the
          // same way this screen degraded before KeyboardPreview shipped.
          fallback: {
            type: "Screen",
            style: { backgroundColor: "transparent", paddingBottom: 32 },
            children: boards,
          },
        },
      ],
    },
    cacheTtlSeconds: 180,
  };
}

function dictionaryScreen(ctx: ScreenContext): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "dictionary",
    title: "Dictionary",
    state: { dictionary: ctx.dictionary ?? [] },
    actions: { err: { kind: "toast", message: "Couldn't save.", tone: "error" } },
    // The amber block reaches the top of the window, so the app's own header
    // has to go. The block carries the way back in its place.
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        // The kicker IS the instruction. A screen of two fields does not also
        // need a sentence under a heading explaining that it is two fields.
        youHead("Type the word, get the phrase.", "Dictionary"),
        {
          type: "Screen",
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: YOU_UI.padding, paddingTop: 20, paddingBottom: 28,
          },
          children: [
            {
              // TWO PILLS AND A SAVE. The column headings are gone — "Word"
              // and "Replace With" label two fields that already say what they
              // are, in their own placeholders.
              //
              // What is NOT gone is the list of pairs already saved. The pairs
              // arrive as more of the same pill, one row each, with the blank
              // one to add always at the end — so an empty dictionary IS two
              // pills and a save, and a full one is the same shape repeated.
              // Dropping the list would have hidden every word the user had
              // added and left no way to remove one.
              type: "DictionaryEditor",
              bind: { value: "dictionary" },
              props: {
                full: true,
                showLabels: false,
                cellRadius: YOU_UI.pill.radius,
                cellBackground: YOU_UI.pill.background,
                cellBorderWidth: 0,
                cellColor: YOU_UI.text,
                placeholderColor: YOU_UI.textFaint,
                cellPaddingHorizontal: 16,
                cellPaddingVertical: 13,
                cellFontSize: YOU_UI.pill.labelSize,
                gap: 8,
                rowGap: YOU_UI.pill.marginBottom,
                removeColor: YOU_UI.textFaint,
                saveLabel: "SAVE",
                saveBackground: YOU_UI.accent,
                saveColor: YOU_UI.onAccent,
                saveRadius: YOU_UI.pill.radius,
                saveHeight: 46,
                saveFontSize: 11,
                saveTracking: 1.9,
                saveFullWidth: true,
              },
              on: { onError: "err" },
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 180,
  };
}

function languageSelectScreen(ctx: ScreenContext): ScreenResponse {
  const row = (l: { value: string; label: string }): Node => ({
    type: "Row",
    props: { label: l.label, value: l.value === ctx.language ? "✓" : "", chevron: false },
    on: { onPress: { kind: "sequence", actions: [
      { kind: "haptic", style: "selection" },
      { kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { language: l.value } },
      { kind: "navigateBack" },
    ] } },
  });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "language_select",
    title: "Language",
    state: { language: ctx.language },
    actions: {},
    root: { type: "Screen", children: LANGUAGES.map(row) },
    cacheTtlSeconds: 600,
  };
}

/**
 * OUT OF WORDS — where the keyboard's mic sends you when there is nothing
 * left to spend.
 *
 * Its own screen rather than the paywall, and that is the whole point. The
 * paywall is a shop: three plans, a price each, a decision to make. Someone
 * who has just pressed a mic in the middle of writing a message did not come
 * shopping — they came to say something and were stopped, and the first thing
 * they need is to be told why in one line. The offer comes second, as a
 * button, not as a price list they have to read to understand what happened.
 *
 * It also has to be a screen and not a card, because the keyboard reaches it
 * by deep link from another app entirely. A card is something the app puts up
 * over what you were doing; there is nothing here to put it over.
 *
 * The way out is the way back: there is no "not now" that leaves you on a
 * dead end. Dismiss returns you to whatever you were writing in.
 */
function wordsOutScreen(ctx: ScreenContext): ScreenResponse {
  const a = ctx.allowance;
  const total = a?.total ?? freeMonthlyWords();
  const used = a?.used ?? total;
  const streak = a?.streakDays ?? 0;
  const w = WORDS_GATE.out;
  const fill = (line: string) => wordsCopy(line, { used, total, streak });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "words_out",
    title: "",
    hideChrome: true,
    state: {},
    actions: {
      upgrade: { kind: "navigate", screenId: WORDS_GATE.paywallScreenId, replace: true },
      // Straight back to the app they were writing in. Anything else strands
      // someone mid-message on a screen they did not choose to open.
      back: { kind: "navigateBack" },
    },
    root: {
      type: "Screen",
      style: {
        flex: 1, backgroundColor: THEME.color.bg,
        paddingHorizontal: 28, paddingTop: 96, paddingBottom: 34,
      },
      children: [
        { type: "Text", props: { content: fill(w.kicker), variant: "overline" },
          style: { color: ACCENT_AMBER } },
        { type: "Text", props: { content: fill(w.title), variant: "h1" } },
        { type: "Text", props: { content: fill(w.body), variant: "muted" },
          style: { marginTop: 12 } },
        // The one fact that is theirs rather than ours. Only shown when there
        // is a streak to show: "0 days" is not encouragement.
        ...(streak > 0
          ? [{
              type: "Text",
              props: { content: fill(w.streakNote), variant: "caption" },
              style: { marginTop: 10 },
            } as Node]
          : []),
        { type: "Spacer", style: { flex: 1 } },
        { type: "Text", props: { content: fill(w.meter), variant: "caption" },
          style: { textAlign: "center", marginBottom: 12 } },
        { type: "Button", props: { label: w.cta, variant: "primary" },
          on: { onPress: "upgrade" } },
        { type: "Button", props: { label: w.back, variant: "ghost" },
          style: { marginTop: 6 }, on: { onPress: "back" } },
      ],
    },
    // Never cached: the whole screen is a statement about a number that
    // changes, and a cached copy of it is a claim that may already be false.
    cacheTtlSeconds: 0,
  };
}

function deleteAccountScreen(): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "delete_account",
    title: "",
    state: {},
    actions: {
      // signOut lives in onSuccess, NOT after the call in a sequence: a failed
      // DELETE used to fall through to signOut anyway, so the user saw an
      // error toast, got signed out, and reasonably concluded the deletion
      // worked — a live 5.1.1(v) hazard.
      confirm: {
        kind: "callEndpoint",
        method: "DELETE",
        path: "/v1/account",
        onSuccess: "deleted",
        onError: "err",
      },
      deleted: { kind: "sequence", actions: [
        { kind: "toast", message: "Your account has been deleted.", tone: "success" },
        { kind: "signOut" },
      ] },
      err: { kind: "toast", message: "Couldn't delete the account. Try again.", tone: "error" },
    },
    root: { type: "Screen", children: [
      { type: "Heading", props: { content: "Delete account" }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginBottom: 14 } },
      { type: "Paragraph", props: { content: "This permanently deletes your account, your personality, and your usage. This cannot be undone." }, style: { marginBottom: 32 } },
      { type: "Button", props: { label: "Delete my account", variant: "danger" }, on: { onPress: "confirm" } },
      { type: "Spacer", style: { height: 10 } },
      { type: "Button", props: { label: "Cancel", variant: "secondary" }, on: { onPress: { kind: "navigateBack" } } },
    ] },
    cacheTtlSeconds: 0,
  };
}

// --- Keyboard config (server-driven keyboard; cached by the native shell) ----

// ---------------------------------------------------------------------------
// SDUI keyboard — the whole thing as a Node tree the native renderer walks.
// ---------------------------------------------------------------------------
//
// Design goals (in order):
//   1. Look and feel indistinguishable from Apple's stock dark keyboard until
//      the user notices the top bar + refine key.
//   2. Real iOS translucency via UIVisualEffectView(systemChromeMaterialDark) —
//      the ONE thing the previous hand-built path could never do because the
//      color parser was hex-only and there was no backing blur view.
//   3. Brand touch WITHOUT screaming: the Return key wears the brand accent,
//      the mic key wears the brand mark. Everything else stays system-neutral.
//   4. Every visible behavior is a data change here — new layouts, new colors,
//      new key shapes, new feature keys all ship as backend JSON.

/** Letter-key builder. Font size 23pt is Apple's actual letter-key size
 * (KeyboardKit unit tests). Weight regular; the shipped SDUI-renderer build
 * applies these to every LetterKey via applyStyle. */
const kLetter = (char: string): KeyboardNode => ({
  type: "LetterKey",
  props: { char },
  style: { flex: 1, fontSize: 23, fontWeight: "regular" },
});

/** Punctuation key on the 123 / #+= pages — same visual + font weight as a
 * letter key but bigger font because these pages use flex-1 across fewer
 * items so each key is naturally wider. */
const kPunct = (char: string): KeyboardNode => ({
  type: "LetterKey",
  props: { char },
  style: { flex: 1, fontSize: 20, fontWeight: "regular" },
});

/** Half-key row-2 indent (Apple pattern). flex:0.5 gives the letters in
 * a-l the exact same width as q-p on ANY screen size — was hardcoded to
 * width:13 before the shipped SDUI renderer supported proportional flex.
 * Post-rebuild, flex works properly and we can scale correctly. */
const kHalfSpacer = (): KeyboardNode => ({ type: "Spacer", style: { flex: 0.5 } });

/** Emits one variant of the tools row (mic / tone pill / refine). Called
 * twice — once with dark palette, once with light — each gated by a
 * visibleIf on state.appearance. Style hex literals don't auto-flip on
 * trait change, so we can't just pass one row and hope the renderer knows.
 */
/** Two-toggle tools row — mic (left, orange) and tone pill (right, defined
 * dark oval). No refine key: stopping the mic auto-runs refinement via the
 * sequence action on tap (needs the queued MicKey Swift patch to fire runRefine
 * inside stopDictation; the sequence-based fallback below handles it TODAY
 * whether or not the patch has landed).
 */
const makeToolsRow = (opts: {
  micBg: string;
  micFg: string;
  toneBg: string;
  toneFg: string;
  toneBorderColor: string;
  visibleIf: any;
}): KeyboardNode => ({
  type: "Row",
  // Compact 44pt row — the two toggles read as accents, not "here's the tools
  // bar you must respect". Uniform padding matches container L/R so the mic
  // sits flush with the keyboard's own left edge and the tone pill flush right.
  style: { gap: 8, height: 44, padding: 4 },
  visibleIf: opts.visibleIf,
  children: [
    // Mic — LEFT side. Solid brand-orange circle. When idle it starts
    // dictation; when recording it stops + immediately fires runRefine so the
    // captured text moves straight into the refinement pipeline.
    //
    // NO explicit `on.onPress` here. The Swift MicKey renderer has a
    // built-in fallback that handles the exact same "tap-to-toggle-and-
    // refine" behavior when no backend action is supplied. This shape works
    // on every client version — new AND old — because it doesn't depend on
    // the client understanding a `condition` action node. Older TestFlight
    // builds without the `condition` action handler were silently no-op-ing
    // on tap; this restores start/stop for them.
    {
      type: "MicKey",
      // Not in a password box.
      //
      // iOS never sees one — the system takes secure fields away from
      // third-party keyboards — but Android hands them over like any other
      // field, and the mic there would record into a field the user filled in
      // with dots and send it to us. The native side refuses it either way;
      // this stops the key being drawn at all, because a key that would be
      // refused is a key that reads as broken.
      //
      // `falsy` on a state key an older client does not publish evaluates
      // true, so every existing build keeps showing the mic exactly as now.
      visibleIf: { falsy: "state.secured" },
      style: {
        flex: 0,
        width: 36,
        height: 36,
        bg: opts.micBg,
        fg: opts.micFg,
        radius: 18,          // circular
      },
    },
    // Middle slot — the suggestion strip (autocorrect revert chip + word
    // completions, K4+ binaries). Replaces the plain spacer: when empty it
    // renders as clear space exactly like the spacer did (and pre-K4 builds
    // never populate it), so the row reads identical until chips appear
    // between the mic and the tone pill. Height 36 matches the row's inner
    // height (44 minus 4pt padding) so no constraint fight with .fill
    // alignment. kb.suggestion.height must agree (it defaults to 36).
    { type: "SuggestionBar", style: { flex: 1, height: 36 } },
    // Tone pill — RIGHT side. Compact oval with a subtle border for shape
    // definition against the transparent keyboard region.
    {
      type: "LetterKey",
      props: { char: "ZU" },
      bind: { content: "tone" },
      on: { onPress: { kind: "cycleTone" } },
      style: {
        flex: 0,
        width: 96,
        // 36, NOT 32: the row's inner content box is 44 − 2×4 padding = 36pt,
        // and the renderer's .fill alignment + required-priority height
        // constraints make any other value an unsatisfiable-constraints break
        // on every mount (mic and suggestion bar are 36 for the same reason).
        height: 36,
        bg: opts.toneBg,
        fg: opts.toneFg,
        radius: 18,
        fontSize: 13,
        fontWeight: "medium",
        borderColor: opts.toneBorderColor,
        borderWidth: 1,
      },
    },
  ],
});

/**
 * Colors picked to match Apple's iOS 17 dark-mode system keyboard exactly.
 *
 * Native iOS uses TWO layers of hierarchy:
 *   - Letter keys sit LIGHTER + more transparent so the blur backdrop reads
 *     through them — this is where the "frosted glass" premium feel comes
 *     from. Fully opaque flat gray is what makes third-party keyboards look
 *     cheap.
 *   - Function keys (shift, backspace, 123, globe, return, etc.) sit DARKER
 *     + more opaque, creating a subtle "recessed" band that visually anchors
 *     the outer edges of the layout.
 *
 * The palette is deliberately restrained — Apple doesn't tint their return
 * key at all in typing fields, and the brand orange we tried before read
 * as "kids-app CTA button" against the muted gray hierarchy. Any brand
 * touch we add later should be far subtler (a colored glyph, not a filled
 * key).
 */
// Palette derived from cross-verified pixel-measurement research (archagon
// tasty-imitation-keyboard, KeyboardKit, sotto-voce). Apple's dark-mode
// keys are NOT semi-transparent dark gray — they're semi-transparent WHITE
// and GRAY over the blur backdrop. That inversion is what makes the keys
// look luminous against the frosted glass instead of dark blocks.
//
//   Letter key:   rgba(255,255,255,0.30)  → #FFFFFF4D
//   Function key: rgba(128,128,128,0.30)  → #8080804D
//   Pressed:      the two swap (letter → function color, and vice-versa)
// Comparing to freshly-captured screenshots of the native iOS dark keyboard:
// letter keys are luminous chips (~55% white over the chrome blur); function
// keys sit recessed (~20% white — darker/dimmer, not brighter). Pressed state
// on both flips brighter for visible touch feedback. Our previous #FFFFFF40
// (25%) letter fill was too thin — the blur swallowed it and everything read
// dimmer than native.

// ---------------------------------------------------------------------------
// Keyboard key rows — ONE definition, consumed by two things.
// ---------------------------------------------------------------------------
//
// The keyboard tree builds its rows from these, and so does the haptics picker.
// The picker has to BE the keyboard, not a list resembling it, and the only way
// that stays true as keys are added is if neither side owns the layout.
const KB_ROW_LETTERS_1 = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
const KB_ROW_LETTERS_2 = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const KB_ROW_LETTERS_3 = ["z", "x", "c", "v", "b", "n", "m"];
const KB_ROW_NUM_1 = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const KB_ROW_NUM_2 = ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""];
const KB_ROW_SYM_1 = ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="];
const KB_ROW_SYM_2 = ["_", "\\", "|", "~", "<", ">", "\u20ac", "\u00a3", "\u00a5", "\u00b7"];
/** Row 3's punctuation, shared by the 123 and #+= layers. */
const KB_ROW_PUNCT_3 = [".", ",", "?", "!", "'"];

const KEY_FILL_LETTER = "#FFFFFF8C";      // 55% white — luminous "floating chip" like native letter keys
const KEY_FILL_FUNCTION = "#FFFFFF33";    // 20% white — recessed/dimmer than letter keys (matches native hierarchy)
const KEY_FILL_SPACE = "#FFFFFF8C";       // matches letter fill
const KEY_FILL_RETURN = "#FFFFFF33";      // matches function fill
const KEY_TEXT = "#FFFFFF";
const KEY_TEXT_FUNCTION = "#FFFFFF";
// Brand amber press color — every key (letter, function, shift, backspace,
// return) flashes brand accent for ~120ms on tap. Fires on touch-down inside
// the Swift renderer's keyTouchDown handler (theme.keyPressed → this hex),
// then keyTouchUp animates back to the resting bg via UIView.animate. This is
// the "typing has our color" identity moment — not a permanent tint.
// Sampled from the mic.animation media so the whole app reads as one palette
// family (previously #FF6B1F pure orange — too punchy against the amber
// media, felt like two different brands sharing the screen).
const KEY_PRESSED = "#E8A23C";            // BRAND_ACCENT — warm amber press feedback on every key
// Brand amber kept only for functional signals — right now that's the
// waveform bars during dictation. Colored feedback when the user is
// speaking; invisible the rest of the time. Not a decorative accent.
const BRAND_ACCENT = "#E8A23C";

// -------- Light-mode counterparts (used by the next SDUI build) -----------
//
// Apple's light-mode dark-keyboard-equivalent palette:
//   Letter key:   rgba(0,0,0,0.05)   → #0000000D  (near-transparent dark)
//   Function key: rgba(0,0,0,0.10)   → #0000001A  (slightly darker recess)
//   Key text:     #000000            (pure black)
//   Blur:         systemChromeMaterialLight
//
// The shipped keyboard renderer doesn't read these yet — until the next build
// adds trait-collection detection, the top-level `theme` (dark) is what's
// applied on every device regardless of mode. But by emitting the light
// palette NOW, the day the build lands the keyboard automatically flips
// with zero backend edit.
// Light-mode letter keys are near-solid WHITE (Apple's actual value has almost
// no transparency — very light chips on a light-gray keyboard region). Our
// previous 5% black was so translucent it dissolved into the app content.
// #FFFFFFE6 (90% white) is what native reads as against the light keyboard
// backdrop and holds up over any light-app content behind it.
const LIGHT_KEY_FILL_LETTER = "#FFFFFFE6";     // 90% white — solid-white chips
export const LIGHT_KEY_FILL_FUNCTION = "#C7CDD3E6";   // ~90% opaque light gray — kept exported for the next light-mode row expansion
const LIGHT_KEY_TEXT = "#000000";

/** Which keyboard is asking. Derived server-side from the request, never
 *  asserted by the client — see keyboardPlatform(). */
export type KeyboardPlatform = "ios" | "android";

export function buildKeyboardConfig(
  personality?: Personality,
  /** Stable id used to place this user in a rollout slice. Omit for anonymous
   *  callers — they get the baseline rather than a per-request coin flip. */
  userId?: string,
  opts: {
    platform?: KeyboardPlatform;
    /** What is left to spend. Absent for an anonymous or unreadable caller,
     *  and then the mic behaves as it always did and the 429 catches it. */
    quota?: { remaining: number; total: number; entitled: boolean };
  } = {},
): KeyboardConfigResponse {
  // English QWERTY. The physical layout arrays are also emitted (below) so
  // older keyboard binaries — the ones without the SDUI renderer — can still
  // render the legacy hand-built keyboard. `features.sdui: true` is the switch
  // the SDUI-capable binary flips to walk `root` instead.
  const letterRow1 = KB_ROW_LETTERS_1;
  const letterRow2 = KB_ROW_LETTERS_2;
  const letterRow3 = KB_ROW_LETTERS_3;

  // Emoji layer removed. Users can access the system emoji keyboard via the
  // globe key in the iOS extension bar below Tulmi, so shipping our own
  // grid was duplicating that at the cost of a keyboard slot.

  // The whole keyboard as a tree. Column of rows; suggestion bar + waveform
  // are conditionally visible via visibleIf against KBState the renderer maintains.
  //
  // IMPORTANT: the blur backdrop is set on theme.backgroundEffect (which the
  // renderer applies to the ENTIRE inputView — Apple's exact behavior). We do
  // NOT put a `blur` effect on this Container too, or we double up and the
  // whole thing reads slightly dimmer than native. Padding is also minimal
  // (3px each side) — Apple's own keyboard edges the keys almost to the screen
  // border; more inner padding is what was making our keyboard look boxed.
  const root: KeyboardNode = {
    type: "Container",
    // Geometry aligned to NATIVE iOS to minimise user discomfort (values from
    // measured Apple teardowns; Apple publishes none officially):
    //   • L/R margin 3pt, top 8pt, bottom 4pt — matches native padding; the 34pt
    //     home-indicator area sits below this on Face ID phones automatically,
    //     which is why native bottom padding is small.
    //   • Horizontal gap between keys 6pt (native constant) — set per-row below.
    //   • Vertical gap between rows 10pt — inside Apple's measured ~10–12pt.
    //   • Row/key height 44pt (set per-row below) — matches a modern iPhone's
    //     ~43–46pt key. (Was 50pt "for a roomier feel"; that read taller than
    //     native, especially on smaller phones.)
    //
    // ANDROID GETS NO SIDE OR BOTTOM PADDING. On iOS that 3pt edge is reclaimed
    // by kb.touch.edgeToMargin, which hands each row's outermost key its own
    // margin, so a touch in it types "a" rather than nothing. Android has no
    // such rule and its key plane works a row at a time, so it cannot reach
    // outside the row it belongs to: those 3pt strips run the full height of
    // the key stack and are the one place on that keyboard where a finger
    // truly lands on nothing. Android also drops `gap` entirely in the mode it
    // ships, so the inset was not buying the visual breathing room it buys
    // here — it was only shrinking the keys.
    style: {
      paddingLeft: opts.platform === "android" ? 0 : 3,
      paddingRight: opts.platform === "android" ? 0 : 3,
      paddingTop: 8,
      paddingBottom: opts.platform === "android" ? 0 : 4,
      gap: 10,
    },
    children: [
      // NOTE: no standalone suggestion bar row. The suggestion strip lives in
      // the middle of the tools row (see makeToolsRow) so predictions appear
      // without adding a whole 44pt band — the keyboard keeps its 272pt
      // height. (The old standalone node was gated on state.hasSuggestions,
      // which pre-K5 clients never exposed, so it never rendered anyway;
      // K5+ exposes it should a future tree want a dedicated row.)

      // Status label + waveform intentionally removed — the mic button's own
      // orange press state + the flash-across-keys animation on refined-text
      // arrival provide all the "is something happening?" feedback we need.
      // GUIDANCE BAND.
      //
      // This was left out on purpose, and the reason was right at the time: a
      // permanent status band turns "Error: 401" and "Listening…" into noise
      // over the keys, and the keyboard should feel calm.
      //
      // What that decision cost, once both keyboards stopped drawing status
      // text at all: every message telling the user how to unblock the thing
      // they just tapped became invisible. Full Access off, microphone denied,
      // session expired — the mic did nothing and said nothing, on the two
      // paths a brand-new user is most likely to hit first. An App Store
      // reviewer who installs the keyboard and does not grant Full Access sees
      // exactly that.
      //
      // Both clients now publish ONLY actionable text into state.status —
      // chatter resolves to empty — so this band is empty in the calm case and
      // present in the one case where silence was the bug.
      {
        type: "Row",
        visibleIf: { truthy: "state.status" },
        style: { height: 26, padding: 4, align: "center" },
        children: [
          {
            type: "LetterKey",
            bind: { content: "status" },
            on: { onPress: { kind: "openApp" } },
            style: {
              flex: 1,
              height: 22,
              bg: "#00000000",
              fg: BRAND_ACCENT,
              fontSize: 12,
              fontWeight: "medium",
            },
          },
        ],
      },

      // Tulmi's tools bar — emitted twice: one dark palette variant and one
      // light palette variant, gated by state.appearance. The Swift renderer's
      // theme.key / theme.keyText auto-flip for letter keys, but style.bg hex
      // literals like KEY_FILL_FUNCTION don't — so a single tree using dark
      // hex reads as dark ovals on a light backdrop. Two variants means the
      // right palette shows up regardless of the OS trait.
      //
      // 44pt matches Apple's suggestion-bar height so tools reads as sitting
      // at the vertical rhythm the OS uses when its own predictive bar would be.
      // Dark-mode tools row — visible when appearance is dark. state.appearance
      // is initialized to "dark" in Swift, so the eq check handles the default
      // case; no need for a redundant `falsy` OR (which forced two evaluations
      // per remount for zero real benefit and added latency to every keystroke).
      // Dark-mode tools row. Mic = solid brand-orange with black icon target
      // (icon renders white on current shipped Swift until the queued tint fix
      // lands — orange bg still reads confidently). Tone pill = solid dark
      // gray with a 1pt subtle border for definition.
      makeToolsRow({
        micBg: BRAND_ACCENT,
        micFg: "#000000",
        toneBg: "#2C2C2E",         // Apple systemGray5 dark — solid, no melt into blur
        toneFg: "#FFFFFF",
        toneBorderColor: "#FFFFFF29",  // 16% white — barely-there border for shape definition
        visibleIf: { neq: ["state.appearance", "light"] },
      }),
      // Light-mode tools row. Same brand orange (works in both modes). Tone
      // pill is solid white with a light-gray border for definition against
      // a light backdrop.
      makeToolsRow({
        micBg: BRAND_ACCENT,
        micFg: "#000000",
        toneBg: "#FFFFFF",
        toneFg: "#000000",
        toneBorderColor: "#00000029",   // 16% black — subtle border on light
        visibleIf: { eq: ["state.appearance", "light"] },
      }),

      // ============================ LETTER LAYER (en) =========================
      // Visible when state.layoutId is "en" (default). Prefixed with "state."
      // so Swift's condition evaluator actually resolves the value — bare
      // paths return null and everything reads as "always shown / never shown".

      // Row 1: q..p
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: letterRow1.map(kLetter),
      },
      // Row 2: a..l (indented half-key each side)
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [kHalfSpacer(), ...letterRow2.map(kLetter), kHalfSpacer()],
      },
      // Row 3: shift, z..m (7 letters), backspace.
      // Shift + backspace are a touch SMALLER (flex 1.1) than a full function
      // key and carry an extra inner spacer, so there's a clear gap between them
      // and the outer letter keys — the letter touch-plane's reach no longer
      // overlaps the shift/backspace hit area, so edge taps don't cross over.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [
          { type: "ShiftKey", style: { flex: 1.35, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
          { type: "Spacer", style: { flex: 0.22 } },
          ...letterRow3.map(kLetter),
          { type: "Spacer", style: { flex: 0.22 } },
          { type: "BackspaceKey", style: { flex: 1.35, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ NUMBER LAYER (123) ========================
      // Apple's iOS number page. Row 1 = digits; Row 2 = -/:;()$&@";
      // Row 3 = #+= · . , ? ! ' · backspace. Tapping "#+=" switches to the
      // symbol page; tapping "ABC" (from row 4) returns to letters.

      // Row 1: 1..0
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: KB_ROW_NUM_1.map(kPunct),
      },
      // Row 2: - / : ; ( ) $ & @ "
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: KB_ROW_NUM_2.map(kPunct),
      },
      // Row 3: [#+=] . , ? ! ' [backspace]
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "#+=" },
            on: { onPress: { kind: "switchLayout", language: "sym" } },
            style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 15, fontWeight: "regular" },
          },
          ...KB_ROW_PUNCT_3.map(kPunct),
          { type: "BackspaceKey", style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ SYMBOL LAYER (sym) ========================

      // Row 1: [ ] { } # % ^ * + =
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: KB_ROW_SYM_1.map(kPunct),
      },
      // Row 2: _ \ | ~ < > € £ ¥ ·
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: KB_ROW_SYM_2.map(kPunct),
      },
      // Row 3: [123] . , ? ! ' [backspace]
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "123" },
            on: { onPress: { kind: "switchLayout", language: "123" } },
            style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 15, fontWeight: "regular" },
          },
          ...KB_ROW_PUNCT_3.map(kPunct),
          { type: "BackspaceKey", style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ BOTTOM ROW (all layers) ===================
      //
      // Row 4 is functionally shared across every layer, but the leftmost key
      // is a mode-switcher whose LABEL and TARGET LAYOUT depend on the current
      // state.layoutId. We emit one variant per mode with visibleIf gates.
      //
      // Flex ratios: the mode-switch key (123 / ABC) is set EQUAL to the return
      // key (2.75) so the space bar sits dead-center of the row — equal flex on
      // both flanks is what centers it — and the numbers key matches the size of
      // the return/search key. The SDUI renderer honors these proportionally on
      // every screen size (Pro / Plus / Pro Max scale correctly, no hardcoded widths).

      // Mode switcher — two variants, each visibleIf-gated:

      // Row 4 (LETTER page) — 123 · 🌐 · space · return.
      //
      // The globe key is REQUIRED, not optional: a keyboard extension has no
      // "system bar" — when needsInputModeSwitchKey is true (any device with
      // more than one keyboard, i.e. virtually all of them) the extension must
      // draw its own switcher, and App Review checks for it. Without it there
      // was no way to reach emoji or another keyboard without leaving the app.
      // visibleIf-gated on the OS signal so the rare single-keyboard setup
      // gets the wider space bar instead.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "123" },
            on: { onPress: { kind: "switchLayout", language: "123" } },
            style: { flex: 2.4, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          {
            type: "GlobeKey",
            visibleIf: { truthy: "state.hasMultipleKeyboards" },
            // Explicit width, NOT flex: a visibleIf-hidden child with flex
            // still gets a required proportional-width constraint from the
            // stack builder while UIStackView collapses it to zero — an
            // unsatisfiable-constraints break on single-keyboard devices.
            // Width children are excluded from the flex pass (like MicKey).
            style: { width: 44, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION },
          },
          // Period and at-sign flank the space bar. Both are constantly needed
          // and both were two taps away on the 123 page — an address or a
          // sentence end should not cost a layer switch.
          //
          // The widths are rebalanced rather than added to: 123 and return give
          // up 0.35 each and space gives up 1.88, so the row's flex total is
          // unchanged and every other key keeps the size it had. Nothing is
          // squeezed to make room.
          { type: "LetterKey", props: { char: "." },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "SpaceKey", style: { flex: 5.2, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "LetterKey", props: { char: "@" },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.4, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },
      // Row 4 for the NUMBER or SYMBOL page — ABC returns to letters; same
      // globe placement as the letter page.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { any: [
          { eq: ["state.layoutId", "123"] },
          { eq: ["state.layoutId", "sym"] },
        ] },
        children: [
          {
            type: "LetterKey",
            props: { char: "ABC" },
            on: { onPress: { kind: "switchLayout", language: "en" } },
            style: { flex: 2.4, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          {
            type: "GlobeKey",
            visibleIf: { truthy: "state.hasMultipleKeyboards" },
            // Explicit width, NOT flex: a visibleIf-hidden child with flex
            // still gets a required proportional-width constraint from the
            // stack builder while UIStackView collapses it to zero — an
            // unsatisfiable-constraints break on single-keyboard devices.
            // Width children are excluded from the flex pass (like MicKey).
            style: { width: 44, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION },
          },
          // Period and at-sign flank the space bar. Both are constantly needed
          // and both were two taps away on the 123 page — an address or a
          // sentence end should not cost a layer switch.
          //
          // The widths are rebalanced rather than added to: 123 and return give
          // up 0.35 each and space gives up 1.88, so the row's flex total is
          // unchanged and every other key keeps the size it had. Nothing is
          // squeezed to make room.
          { type: "LetterKey", props: { char: "." },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "SpaceKey", style: { flex: 5.2, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "LetterKey", props: { char: "@" },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.4, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },

      // ========================= NUMBER-ONLY LAYER (num) ======================
      // Shown when the FIELD itself only accepts numbers — an OTP box, a phone
      // number, an amount. The client sets layoutId to "num" on focus and back
      // to "en" when it leaves; nothing switches to this layer by hand.
      //
      // A dialer grid, not our 123 page: a number field wants big targets in
      // the arrangement people already know, and the 123 page is a full QWERTY-
      // width row of tiny keys with punctuation the field will reject anyway.
      //
      // ABC is kept in the corner deliberately. If we ever misread a field as
      // numeric, the user must not be trapped in a pad that cannot type — the
      // same reason the globe key exists.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          ...["1", "2", "3"].map(kPunct),
          { type: "BackspaceKey", style: { flex: 1, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          ...["4", "5", "6"].map(kPunct),
          { type: "Spacer", style: { flex: 1 } },
        ],
      },
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          ...["7", "8", "9"].map(kPunct),
          { type: "Spacer", style: { flex: 1 } },
        ],
      },
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "ABC" },
            on: { onPress: { kind: "switchLayout", language: "en" } },
            style: { flex: 1, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          kPunct("0"),
          kPunct("."),
          { type: "ReturnKey", style: { flex: 1, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },
    ],
  };

  // Named actions — referenced by node `on` handlers by string name. Lets us
  // change the bound behavior of a key (e.g. what the 123 key does) without
  // editing the tree, and keeps the tree readable.
  const actions: Record<string, KeyboardActionSpec> = {
    cycleLayout: { kind: "switchLayout" },      // no language = cycle
    showLangs: { kind: "showLanguageMenu" },
    dictateStart: { kind: "startDictation" },
    dictateStop: { kind: "stopDictation" },
    refine: { kind: "runRefine" },
  };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    // Bump so warm keyboard sessions re-fetch on next open when we push a new
    // tree; the native cache respects this the same way SduiApp does.
    cacheVersion: currentCacheVersion(),
    theme: {
      // Legacy fields — read by the pre-SDUI binary as opaque hex. New builds
      // walk `root` and ignore these once features.sdui takes over.
      //
      // theme.key IS what SDUI LetterKey nodes use when they don't set an
      // explicit `bg` in their style — so wiring the new palette here is what
      // makes the letter keys actually pick up the lighter, more translucent
      // fill instead of the legacy #48484a opaque gray.
      // Fully transparent — no our-blur, no our-fill. This lets iOS's own
      // keyboard-region backdrop show through (the "OS chrome"), which every
      // third-party keyboard sits over. Whatever the OS paints there IS what
      // the user sees behind the keys. If this reads cleaner than our applied
      // blur was, we ditch the blur entirely.
      background: "#00000000",
      key: KEY_FILL_LETTER,
      keyText: KEY_TEXT,
      // Accent used ONLY by legacy path for the shift-active indicator dot.
      // The SDUI tree above doesn't reference this — return + refine keys
      // are plain function-key styled now.
      accent: "#8E8E93",
      keyPressed: KEY_PRESSED,
      // v2 fields — used only by the SDUI renderer:
      // No backgroundEffect. When set to null, the Swift renderer skips
      // installing the UIVisualEffectView backdrop entirely — the extension
      // is truly transparent and iOS's own region backdrop is the only
      // thing behind the keys.
      keyRadius: 5,     // Apple's letter-key radius on dark mode is 5, not 6
      keyShadow: true,  // hard 1pt drop shadow — matches Apple's key depth
    },
    // v3 adaptive palettes — the SDUI-renderer build picks between these
    // based on the current userInterfaceStyle and re-renders on trait change.
    themeDark: {
      background: "#00000000",
      key: KEY_FILL_LETTER,
      keyText: KEY_TEXT,
      accent: "#8E8E93",
      keyPressed: KEY_PRESSED,
      keyRadius: 5,
      keyShadow: true,
    },
    themeLight: {
      // Fully transparent — no our-backdrop. Keys sit directly on whatever
      // iOS composits behind the keyboard region (usually a subtle light-gray
      // system chrome). This is the "no sheet, keys on the base surface"
      // pattern — same as themeDark. Removed backgroundEffect so we don't
      // paint our own blur that would double-tint the light system chrome.
      background: "#00000000",
      key: LIGHT_KEY_FILL_LETTER,
      keyText: LIGHT_KEY_TEXT,
      accent: "#8E8E93",
      // Same brand-orange press flash as dark mode — the moment of tap
      // reads as the Tulmi accent regardless of appearance.
      keyPressed: KEY_PRESSED,
      keyRadius: 5,
      keyShadow: true,
    },
    // Layouts array stays populated for the legacy path. Adding a new language
    // here + shipping a matching { type: "LetterKey" } tree gets the new SDUI
    // keyboard when we generate per-language roots.
    // Every layout the mode-switcher on row 4 can jump to. The SDUI-renderer
    // build's switchLayout(language:) validates against this list; the legacy
    // path still renders the "en" entry (never sees the 123/sym metadata).
    layouts: [
      {
        language: "en",
        displayName: "English",
        rows: [
          letterRow1,
          letterRow2,
          ["{shift}", ...letterRow3, "{backspace}"],
          ["{globe}", "{mic}", "{refine}", "{space}", "{return}"],
        ],
      },
      { language: "123", displayName: "Numbers", rows: [] },
      { language: "sym", displayName: "Symbols", rows: [] },
      // Field-driven, never reached from the layer switcher — but it must be
      // listed or switchLayout("num") is rejected as an unknown language.
      { language: "num", displayName: "Number pad", rows: [] },
      // "emoji" removed: no tree rows are gated on it, so switching to it
      // rendered a keyboard with no keys and no way back — a live trap now
      // that the globe key exists (its long-press language menu lists every
      // layout here). System emoji is reached via the globe instead.
    ],
    features: {
      voice: true,
      refine: true,
      streaming: false,
      // Android ONLY: record + live-stream the mic directly IN the keyboard
      // (an Android IME can hold the mic in-process, unlike an iOS extension).
      // So Android needs no Flow Session and no arming screen — tap the mic and
      // dictate, words appear live. iOS ignores this and uses kb.mic.mode="flow"
      // (the background-audio path) since iOS forbids extension recording.
      liveVoice: true,
      // The switch: capable binaries walk root+actions; older ones fall through
      // to the hand-built layout.
      sdui: true,
    },
    labels: {
      refine: "Refine",
      listening: "Listening…",
      transcribing: "Transcribing…",
      refining: "Refining…",
      // Blank by owner decision: the bar's size says what it is. Both
      // keyboards honour "" as a label, not as a missing one.
      space: "",
      return: "return",
      needFullAccess: "Enable Full Access to use voice + Refine.",
      language: "Language",
      // Branded, non-technical status text (both keyboards fall back to these
      // exact strings if the backend omits them — editing here re-words them
      // over-the-air, no rebuild). 444 = mic/capture failed ("not listening");
      // 222 = backend/processing failed ("we'll be back").
      voice_not_listening: "444 : Not Listening",
      voice_unavailable: "222 : will let you know when we are back",
      // Flow Session (kb.mic.mode="flow", iOS). Wispr-style copy — but the mic
      // button should read as a clean, native, ICON-ONLY control (bolt → mic →
      // ✓), so ALL three flow status strings are blanked. Blank ("") means the
      // keyboard shows no hint text at all in that state — the glyph is the only
      // cue. Put any string back here (OTA, no rebuild) to reintroduce guidance:
      //   flow_start_hint → shown under the "Start Flow" (no-session) state
      //   flow_arming     → shown after the first tap opens the app to arm
      //   flow_arm_manual → shown when iOS refused the auto-open (open by hand)
      // Blank by owner decision: the keyboard stays icon-only — no Flow hint
      // text over the keys, no "Start Flow" state. The background-mic story
      // is carried by the App Review notes, the mic purpose string, the
      // privacy policy's Flow Session section, and the Settings off switch.
      // Any string here re-introduces on-keyboard guidance OTA if ever wanted.
      flow_start_hint: "",
      flow_arming: "",
      flow_arm_manual: "",
    },
    root,
    actions,
    // Backend-tunable knobs. Every value here has a Swift-side default so
    // this can stay empty and everything still works; overriding any key
    // changes that specific behavior without a rebuild.
    //
    // Uncomment / add entries as needed. See shared/types/sdui.ts for the
    // full authoritative list of keys and their defaults.
    flags: (() => {
      // Assemble the flag bag. Static entries first; then splice in the mic
      // media if there's one in the media registry so the keyboard's mic
      // matches the main app's without a rebuild.
      const flags: Record<string, unknown> = {
        // Example overrides (uncomment to try):
        //
        // "kb.press.fadeMs": 120,
        // "kb.dictation.dots.color": "#E8A23C",
        // "kb.dictation.dots.birthRate": 7,
        // "kb.dictation.dots.decayMs": 2500,
        // "kb.dictation.dim.alpha": 0.45,
        // "kb.mic.recordingIcon": { sf: "pause.fill" },
        // "kb.mic.recordingIcon": { sf: "waveform" },
        // "kb.mic.recordingIcon": { emoji: "⏹" },
        // "kb.mic.recordingIcon": { url: "https://cdn.tailzu.space/kb/stop.png" },
        // "kb.mic.idleIcon": { asset: "TailzuMark" },
        // Recording particle swarm (iOS), OTA-tuned — takes effect on the
        // CURRENT installed build (these keys are read live). Tiny dots (radius
        // in pt), fewer + a larger play area (smaller inset) so they read as
        // very tiny wandering specks, not a compact blob.
        "kb.mic.particles.radius": 0.55,
        "kb.mic.particles.count": 42,
        "kb.mic.particles.inset": 4,
        // Kill the flowing dot-stream that rises off the mic while recording —
        // birthRate 0 emits nothing. Only the in-button swarm remains.
        "kb.dictation.dots.birthRate": 0,
        // While the mic is recording, the keys go behind frosted glass AND stop
        // taking touches.
        //
        // The blur is the signal — the keys are still there, they are just not
        // yours for the moment — and blocksTouches is what makes it true rather
        // than decorative. Without it the keyboard looked disabled and typed
        // anyway, so a stray thumb mid-utterance inserted a character into the
        // very text the refine pass was about to rewrite.
        //
        // The tools row is deliberately NOT covered: the mic that stops the
        // recording lives there, and blurring the way out of a state is how you
        // strand someone in it.
        // OFF until the build that has the BLUR ships.
        //
        // This was already false, with a comment saying so, and turning it on
        // ahead of the native work was a regression: the shipped binary has
        // only the flat black scrim, and over a transparent keyboard sitting on
        // iOS's pale light-mode region that is a grey sheet behind the whole
        // keyboard, not a dim. The keyboard looked fine during recording before
        // and looked broken after, for no gain at all.
        //
        // Flip to true once a build containing kb.dictation.dim.blur is out —
        // one backend edit, no rebuild. Everything else in this block is
        // already tuned for that day.
        // The overlay stays ON while dictating, but it is INVISIBLE.
        //
        // Two jobs were bundled into one thing: it veiled the keys, and it
        // swallowed their touches. The veil is unwanted — it reads as a grey
        // sheet dropped over the keyboard — but the touch blocking is what
        // stops a stray thumb inserting a character into the middle of the
        // sentence being dictated, which is a genuinely bad failure and one
        // this keyboard has already had.
        //
        // So: enabled and blocksTouches stay true, and every visual dimension
        // goes to zero. The keys look exactly as they always do; they just
        // cannot be typed while the mic is live.
        "kb.dictation.dim.enabled": true,
        "kb.dictation.dim.blur": false,         // iOS UIVisualEffectView — off
        "kb.dictation.dim.blurRadius": 0,       // Android RenderEffect, API 31+
        // The TINT is now nearly nothing, and that is the fix for "the whole
        // keyboard sits on a grey sheet".
        //
        // Our background is deliberately transparent so iOS's own keyboard
        // region shows through. In LIGHT appearance that region is pale, so
        // black at 45% over it did not read as "dimmed" — it read as a grey
        // slab dropped behind the entire keyboard, which is a different and
        // much worse thing.
        //
        // The blur carries the "not now" signal on its own. The tint only has
        // to nudge it, so it is a whisper; raise it only for builds with no
        // blur to fall back on.
        "kb.dictation.dim.alpha": 0,
        "kb.dictation.dim.keyAlpha": 1,         // Android: keys do not fade
        // Builds with no blur to fall back on still need a real veil — that
        // one is served separately so lowering the blur tint cannot silently
        // leave an older binary showing nothing at all during recording.
        // The flat veil's opacity, and the one that produced the grey sheet.
        // Zero: the view is still there and still swallows touches, it just
        // paints nothing.
        "kb.dictation.dim.fallbackAlpha": 0,
        "kb.dictation.dim.blocksTouches": true,
        // "kb.shift.lockedColor": "#E8A23C",
        // "kb.shift.longPressMs": 350,
        // "kb.shift.iconLowerOutlined": "arrowtriangle.down",
        // Double-tap shift → caps lock (system-keyboard behavior). Window in ms
        // for the second tap; hold-to-lock still works too. Default 300.
        // "kb.shift.doubleTapMs": 300,
        // "kb.delete.repeatIntervalMs": 90,
        // "kb.autoCap.enabled": true,
        // "kb.smartPunctuation": true,
        // Key-pop callout — the native magnified bubble above a pressed letter.
        // On by default; every value below has a native default in Swift, so
        // these only need setting to OVERRIDE. iOS-only.
        //   kb.callout.enabled  (bool, default true) — set false to disable the pop
        //   kb.callout.bg       (hex) — balloon fill; default white (light theme)
        //                         / lighter-than-key gray (dark theme)
        //   kb.callout.text     (hex) — glyph color; default near-black / white
        // "kb.callout.enabled": true,
        // "kb.callout.bg": "#FFFFFF",
        // "kb.callout.text": "#111111",
        // Multi-touch / rolling key plane (iOS). Routes the character keys
        // through the custom KeyPlaneView for true rolling + two-thumb typing +
        // gap routing (the fast-typing gap vs the system keyboard). iOS-only —
        // Android ignores this flag.
        // Re-enabled after hardening the plane's key detection: it now re-derives
        // the key rects at the start of every touch (touchesBegan → refreshFrames)
        // instead of trusting a layout-time cache that could go stale and
        // mis-detect keys — the earlier "only a dead-center tap types" cause.
        // The same build also carries the hit-slop per-button grid, so this flag
        // is a clean OTA A/B switch: false falls straight back to that grid
        // (which also restores accent long-press trays) if a device ever shows
        // trouble — no rebuild needed.
        "kb.keyPlane.enabled": true,

        // Space, return and backspace take part in the touch partition.
        //
        // Without this the plane owned only the LETTER grid, and its
        // nearest-key fallback was gated on that grid's bounding box — so the
        // bottom row, and every gap between its keys, was refused by the plane
        // and left to each button's own small hit area. That is the dead zone
        // the user reported, and it is why raising the slops changed nothing:
        // the plane was never asked about those points.
        //
        // Off falls back to that behaviour exactly, so this is a clean switch
        // if the wider ownership ever mis-targets.
        //
        // The globe key is deliberately NOT in the partition, in the app or
        // here: it opens the system keyboard switcher, and a near-miss
        // silently swapping the user's keyboard is worse than one doing
        // nothing.
        "kb.keyPlane.actionKeys": true,

        // ------------------------------------------------------------------
        // Every remaining native knob, served at its COMPILED DEFAULT.
        //
        // 110 values were read by the keyboards and never sent, so each was
        // frozen at whatever the binary was built with — tuning any of them
        // meant a store round. They are emitted here at exactly the value the
        // native code already used, so nothing changes behaviour today and
        // every one of them becomes adjustable without a build.
        //
        // The ONE deliberate change is kb.touch.holdMultiplier: iOS defaulted
        // to 1.0, which switches the drift tolerance OFF, while Android used
        // 1.35. A finger that rolls a millimetre while pressing was retargeting
        // to the neighbour on iOS — the exact "it did not register my key"
        // failure the key plane exists to prevent. Both platforms now get 1.35.
        // ------------------------------------------------------------------
        // accentTray
        "kb.accentTray.chipActiveBg": "#007AFF",
        "kb.accentTray.chipFontSize": 22,
        "kb.accentTray.chipRadius": 6,
        "kb.accentTray.chipWidth": 40,
        "kb.accentTray.gap": 4,
        "kb.accentTray.height": 48,
        "kb.accentTray.longPressMs": 500,
        "kb.accentTray.offsetY": -52,
        "kb.accentTray.padding": 4,
        "kb.accentTray.radius": 8,
        // autoCap
        "kb.autoCap.enabled": true,
        // autocorrect
        "kb.autocorrect.lang": "",
        "kb.autocorrect.neighborCost": 0.5,
        "kb.autocorrect.punctCost": 0.5,
        // callout
        "kb.callout.bg": "",
        "kb.callout.enabled": true,
        "kb.callout.text": "",
        // confetti
        "kb.confetti.birthRate": 6,
        "kb.confetti.burstMs": 400,
        "kb.confetti.lifetimeMs": 3000,
        "kb.confetti.scale": 0.06,
        "kb.confetti.spin": 3,
        "kb.confetti.teardownMs": 3500,
        "kb.confetti.velocity": 200,
        // delete
        "kb.delete.initialDelayMs": 500,
        "kb.delete.repeatIntervalMs": 90,
        "kb.delete.wordAfterChars": 20,
        // dictation
        "kb.dictation.dim.fadeMs": 250,
        "kb.dictation.dots.alphaSpeed": -0.55,
        "kb.dictation.dots.color": "#E8A23C",
        "kb.dictation.dots.decayMs": 2500,
        "kb.dictation.dots.enabled": true,
        "kb.dictation.dots.lifetimeMs": 1800,
        "kb.dictation.dots.scale": 0.35,
        "kb.dictation.dots.scaleRange": 0.1,
        "kb.dictation.dots.size": 14,
        "kb.dictation.dots.spread": 0.08,
        "kb.dictation.dots.velocityJitter": 0.05,
        // flow
        "kb.flow.armGlyph.enabled": false,
        "kb.flow.glyphSize": 16,
        // haptics
        "kb.haptics.enabled": true,
        "kb.haptics.style": "selection",
        // key
        // 3, not 2 — half the 6pt inter-key gap, so two neighbours meet exactly
        // in the middle of it.
        //
        // The letter grid never needed this: the touch plane routes its gaps by
        // nearest-key. The BOTTOM row does — 123 / . / space / @ / return sit
        // outside the grid band, so each key covers only its own rect plus this
        // slop. At 2 that left a 2pt dead strip in every 6pt gap, four times
        // over, on the row thumbs use most. At 3 the row is continuous.
        //
        // Not 4: that would overlap neighbours, and in an overlap UIKit gives
        // the touch to whichever key is on top rather than to the nearer one —
        // trading dead space for a silent bias, which is worse.
        "kb.key.hitSlop.x": 3,
        "kb.key.hitSlop.y": 10,
        "kb.key.shadow.color": "#000000",
        "kb.key.shadow.offsetY": 1,
        "kb.key.shadow.opacity": 0.4,
        "kb.key.shadow.radius": 0,
        // layer
        "kb.layer.lettersId": "en",
        "kb.layer.symbolIds": "123,sym",
        // mic
        "kb.mic.particles": true,
        // network
        "kb.network.timeoutMs": 15000,
        // press
        "kb.press.fadeMs": 120,
        // returnKey
        "kb.returnKey.actionBg": "#007AFF",
        "kb.returnKey.actionFg": "#FFFFFF",
        // row
        "kb.row.expandHitTargets": true,
        // shift
        "kb.shift.doubleTapMs": 300,
        "kb.shift.iconLowerLocked": "arrowtriangle.down.fill",
        "kb.shift.iconLowerOutlined": "arrowtriangle.down",
        "kb.shift.iconSize": 16,
        "kb.shift.iconUpperLocked": "arrowtriangle.up.fill",
        "kb.shift.iconUpperOutlined": "arrowtriangle.up",
        "kb.shift.iconWeight": "semibold",
        "kb.shift.lockedColor": "#E8A23C",
        "kb.shift.longPressMs": 350,
        // smartPeriod
        "kb.smartPeriod.windowMs": 500,
        // suggestion
        "kb.suggestion.chipBorderWidth": 1,
        "kb.suggestion.chipPadH": 12,
        "kb.suggestion.chipPadV": 4,
        "kb.suggestion.chipRadius": 12,
        "kb.suggestion.dividerHeight": 18,
        "kb.suggestion.edgeInset": 8,
        "kb.suggestion.emphasizeFirst": true,
        "kb.suggestion.fontSize": 15,
        "kb.suggestion.gap": 8,
        "kb.suggestion.height": 36,
        "kb.suggestion.leadBg": "#E8A23C",
        "kb.suggestion.leadFg": "#000000",
        "kb.suggestion.style": "chips",
        // toast
        "kb.toast.color.error": "#FF3B30E6",
        "kb.toast.color.info": "#000000D9",
        "kb.toast.color.success": "#34C759E6",
        "kb.toast.durationMs": 2000,
        "kb.toast.fadeInMs": 180,
        "kb.toast.fadeOutMs": 250,
        "kb.toast.fontSize": 13,
        "kb.toast.height": 32,
        "kb.toast.offsetY": -18,
        // tone
        "kb.tone.sheet.accent": "#E8A23C",
        "kb.tone.sheet.enabled": true,
        "kb.tone.sheet.longPressMs": 300,
        // touch
        // Widened. A light tap that iOS cancels instead of ending is only
        // rescued when it was short and still; "hard touches register, light
        // ones don't" is exactly the shape of taps falling just outside these
        // bounds. The rescue acts only on touches iOS already cancelled and
        // that have not committed, so it can never type twice — widening it
        // only risks committing a cancelled gesture that was still, brief and
        // a tap in every measurable way.
        "kb.touch.cancelCommit.maxDriftPt": 24,
        "kb.touch.cancelCommit.maxMs": 700,
        "kb.touch.fillGaps": true,

        // ANDROID: how far inside its row a key is PAINTED. Its touch area

        // keeps the row's full height either way, so setting this and

        // removing the same amount from the column's row gap makes the

        // band between rows belong to the rows instead of to nobody — the

        // structural dead zone iOS spent six builds on. 0 = unchanged.

        // Try it on a device before moving the gap; both are values here.

        "kb.touch.vInsetPx": 0,
        // K30's two fixes, both switchable from here.
        //
        // This problem has cost six builds, five of them chasing a wrong
        // diagnosis, and native Swift cannot be OTA'd — so every wrong guess
        // was another build. These exist so the NEXT adjustment, in either
        // direction, is a value in this file instead.
        //
        // alwaysRefresh: rebuild key geometry on every layout pass, which is
        // what the debug overlay was doing by accident and why the keyboard
        // measurably worked with it on.
        //
        // BACK ON, and staying on. It was turned off with the overlay on the
        // theory that K31's per-row witnesses made it redundant. The dead gaps
        // came straight back, which says the cheap check is not equivalent —
        // and the likely reason is ordering, not correctness: the plane lays
        // out before the key buttons settle, so every witness compares a stale
        // rect against the stale rect it recorded, agrees with itself, and
        // reports a grid that has not moved. Rebuilding unconditionally cannot
        // be fooled that way.
        //
        // The cost is real and it is small: forty-odd coordinate conversions
        // per layout pass. A keyboard with dead gaps is not cheaper.
        "kb.touch.alwaysRefresh": true,
        // totalResolve: a point the plane claimed always resolves to a key.
        // OFF restores the old behaviour, where a claimed point the resolver
        // could not place was dropped in silence.
        "kb.touch.totalResolve": true,
        "kb.touch.holdMultiplier": 1.35,
        // waveform
        "kb.waveform.barCount": 24,
        "kb.waveform.baselineMax": 0.6,
        "kb.waveform.baselineMin": 0.2,
        "kb.waveform.color": "#999999",
        "kb.waveform.fps": 30,
        "kb.waveform.height": 24,
        "kb.waveform.levelMultiplier": 0.6,
        "kb.waveform.radius": 1.5,
        "kb.waveform.spacing": 3,
        // Draw the key rows instead of building a Button per key.
        //
        // This is the one structural difference left between us and the system
        // keyboards: they paint every key into a single surface, we built ~30
        // views and paid a measure/layout pass for each. Drawn mode collapses a
        // row to ONE view whose keys are geometry.
        //
        // OFF until it has been used on a real device. Both renderers are in
        // the binary and the touch resolution is shared, so this is a flip in
        // either direction with NO rebuild — which is the whole point of
        // shipping it behind a flag rather than swapping the renderer outright.
        // Rows the drawn path does not fully reproduce (anything with a globe,
        // mic or suggestion strip) fall back to views on their own.
        "kb.render.drawnKeys": false,
        // --- K18: the last compiled-in choices, now data ------------------
        // Functional-key glyphs. Full icon-spec vocabulary, so a symbol can
        // become an emoji or a hosted image without a rebuild:
        //   { "sf": "delete.left" } | { "emoji": "⌫" } | { "url": "https://…" }
        // A per-key override can also ride in the tree as props.icon.
        // "kb.icon.backspace": { "sf": "delete.left" },
        // "kb.icon.globe": { "sf": "globe" },
        // "kb.icon.refine": { "sf": "sparkles" },
        //
        // Suggestion bar SHAPE (not just its colours):
        //   "chips" (default) — rounded pills, brand amber on the lead
        //   "flat"            — the native three-slot strip: no surfaces, thin
        //                       dividers, lead distinguished by weight/colour
        // "kb.suggestion.style": "chips",
        // "kb.suggestion.dividerColor": "#FFFFFF24",
        // "kb.suggestion.dividerHeight": 18,
        // --- K12 knobs: everything below was hardcoded in the binary until
        // now, and each is a value real-world use is likely to argue with.
        //
        // Key haptics — the most polarizing keyboard setting there is.
        // enabled=false silences them entirely; style is "selection"
        // (default, the crisp native tick) | light | medium | heavy | rigid |
        // soft. iOS still requires Full Access for any of it.
        // ---- Per-key haptics -------------------------------------------
        // Two ways to be on, because "all keys" and "the keys I chose" are
        // different preferences and neither should erase the other:
        //
        //   kb.haptics.all   — every key buzzes. The card's master toggle.
        //   kb.haptics.keys  — a set of individual keys the user picked. A key
        //                      listed here buzzes even when .all is off.
        //
        // Default is silence on both. A keyboard that buzzes on every letter
        // out of the box is a setting people go looking for how to turn OFF,
        // so it is opt-in in either direction.
        //
        // Keys are named by what they insert (" ", ".", "a") or by role
        // ("shift", "backspace", "return", "space", "mic", "refine"), so the
        // picker in the app and the keyboard agree without a shared table.
        "kb.haptics.all": false,
        "kb.haptics.keys": {},
        // "kb.haptics.style": "selection",
        //
        // Touch feel (K11). holdMultiplier is how far a finger may drift off
        // the pressed key before the press cancels, as a multiple of the key's
        // own size — native keeps a key held through a lot of drift, so 1.0
        // means "one key-width of slack". Lower = twitchier, higher =
        // stickier, 0 = the old behavior where any drift onto dead space
        // dropped the keystroke.
        // holdMultiplier is served live above at 1.35. It used to be commented
        // out here at 1.0, which is the value that DISABLES the drift slack —
        // and iOS was compiled with exactly that, so a finger rolling a
        // millimetre retargeted to the neighbour.
        // cancelCommit rescues taps iOS CANCELS rather than ends — the
        // home-indicator band overlaps the bottom row and steals quick light
        // taps there. A cancelled touch shorter than maxMs that moved less
        // than maxDriftPt is treated as a real tap. maxMs 0 disables the
        // rescue.
        // "kb.touch.cancelCommit.maxMs": 300,
        // "kb.touch.cancelCommit.maxDriftPt": 12,
        //
        // Autocorrect aggressiveness. Together with maxDistance these ARE the
        // dial: a neighbor-key substitution ("gome"→"home") costs
        // neighborCost, a missing apostrophe/space ("dont"→"don't") costs
        // punctCost, everything else costs 1. LOWER = more words get
        // "fixed". A wrong correction costs far more trust than a missed one,
        // so raise these to make it more conservative.
        // "kb.autocorrect.neighborCost": 0.5,
        // "kb.autocorrect.punctCost": 0.5,
        // Debug build stamp (orange "K1" in the keyboard's corner). The Swift
        // default is FALSE so store builds never show it. To verify a fresh
        // binary + live OTA delivery in one shot: flip this to true + cache
        // bump — the stamp appearing proves both — then flip back off.
        // ON, temporarily. Every keyboard fix I have made in this session is a
        // FLAG — holdMultiplier, hitSlop, fillGaps — and a flag only does
        // anything if the config actually reaches the keyboard. The keyboard
        // needs Full Access and a valid token to fetch it; without either it
        // runs entirely on compiled defaults, including holdMultiplier 1.0,
        // which disables the drift slack.
        //
        // The stamp settles that in one glance: a version means config is
        // arriving and the touch values with it; nothing means every fix has
        // been sitting on the server doing nothing. Turn back off once known.
        // ON, TEMPORARILY. The gaps still read as dead and there are two
        // candidate causes that look identical from the outside — the plane
        // refusing the point, or the plane not running at all. The stamp says
        // which in one glance: "NOPLANE" means it never mounted; otherwise
        // k/a/r are the keys, action keys and role keys it partitioned, v the
        // obstacles, y/h the band's top and height, and t(x,y)Y|N whether the
        // LAST touch was claimed. Tap a dead gap and read the letter.
        //
        // Off. It did its job — the stamp is how we learned build 60 was
        // running its embedded bundle and had never taken an update.
        "kb.buildStamp.enabled": false,
        // Cold-open field diagnostics (K3+ binaries). With this on, tapping the
        // keyboard mic shows "<stamp> · <path>" in the status bar — e.g.
        // "K3 · app✓@2 open=NO" (found UIApplication, iOS refused the open) or
        // "K3 · app✗ legacy=YES" (no UIApplication in the chain, legacy path
        // claimed a hit). A console-log substitute readable on the phone.
        // Flip OFF (with the deploy's automatic cache bump) once diagnosed.
        "kb.coldOpen.debugStatus": false,
        // Idle mic mark inset (points). The TailzuMark spans its full canvas
        // width, so 0 makes the "structure" touch the button's side walls
        // instead of sitting small in the middle. OTA-tunable — takes effect on
        // the current build without a rebuild.
        "kb.mic.idleIconInset": 0,
        // Mic mode (iOS only — Android reads `liveVoice` and records in-process,
        // which iOS extensions CANNOT do). iOS blocks microphone recording
        // inside a keyboard extension: even with Full Access,
        // AVAudioRecorder.record() returns false ("doesn't have entitlements to
        // record audio"). So the working iOS path is a background-audio "Flow
        // Session" (the Wispr Flow model): the first mic tap opens the app,
        // which holds the mic alive in the BACKGROUND; the user swipes back and
        // then dictations run from the keyboard without leaving it, until the
        // session idles out. See FlowSessionManager / TulmiFlow. Requires the
        // native flow code in the build. OTA-flippable to "handoff" (open app
        // per dictation) / "local" / "stream".
        // iOS only — the Android keyboard has its own capture path and does
        // not read this flag. Changing it has no effect on Android.
        "kb.mic.mode": "flow",
        // Show ONLY the finished sentence. Both engines still stream while the
        // user speaks — transcription is done by the time they stop, so this
        // costs no real time — but nothing reaches the cursor until the text is
        // written properly. Watching "whats up" appear and turn into "WhatsApp"
        // makes the product look like it is correcting its own mistakes;
        // landing one finished sentence makes it look like it understood.
        // Set false to paint the raw transcript live and rewrite it on stop.
        "kb.mic.deferUntilStop": true,
        // How long a Flow Session stays live (mic held in the background) with
        // no dictation before it must be re-armed by re-opening the app.
        // Wispr's default is 5 min; raise for fewer app hops.
        "kb.flow.idleTimeoutMs": FLOW_IDLE_TIMEOUT_MS,
        // Flow mic button glyphs (SF Symbol names). Wispr's exact model:
        //   startGlyph → shown when NO session is live (the "Start Flow" state;
        //                first tap opens the app to arm).
        //   stopGlyph  → shown WHILE recording (tap it to finish — Wispr's ✓).
        // The armed-idle state uses the normal mic/brand mark. OTA-tunable.
        "kb.flow.startGlyph": "bolt.fill",
        "kb.flow.stopGlyph": "checkmark",
        // TRANSPORT — how a dictated utterance reaches the server. Flippable
        // per cohort, no rebuild (build 53+).
        //   "stream"  → PCM goes up a socket as the user speaks. Transcription
        //               finishes as they stop, so the written sentence lands
        //               fastest. Cost: a dropped socket loses the words
        //               outright — they existed nowhere but in flight.
        //   "oneshot" → the app buffers the utterance and POSTs it once to
        //               /v1/transcribe-clean, the same endpoint (and the same
        //               Sarvam+Whisper fusion) the in-app mic uses. The audio
        //               still exists on the phone afterwards, so a failed
        //               request retries instead of losing the dictation, and
        //               the two surfaces stop diverging. Cost: transcription
        //               starts at stop, so the wait is longer on long
        //               utterances.
        // Streaming stays the default: it is faster, and it is the path with
        // real usage behind it.
        // Set this globally (FLOW_TRANSPORT), NOT as a cohort rollout: the app
        // reads it from /v1/app/bootstrap and the keyboard from
        // /v1/keyboard/config, and only the latter runs rollouts — so a
        // targeted rule would put the two halves of one dictation into
        // different modes.
        "kb.flow.transport": FLOW_TRANSPORT,
        // How long to wait after the mic stops before writing what was said —
        // the tail of an utterance is usually still in flight. Also the poll
        // interval while waiting for a one-shot upload to come back.
        "kb.flow.settleMs": 450,
        // Dictation "button logic" — WHEN the words hit the field. This is the
        // one knob that flips live-vs-after-stop without a rebuild (once the
        // reader is in the build; build 39+):
        //   true  → words paint the field LIVE as you speak (streaming feel)
        //   false → nothing shows until you STOP; then the whole utterance lands
        //           in one block (cleaner, no half-formed words on the typepad)
        // Governs iOS Flow, the iOS in-keyboard stream, and Android liveVoice
        // alike. Note a batch provider (Groq) has no interim partials to begin
        // with, so it already behaves as after-stop; this flag is what lets a
        // STREAMING provider (Deepgram) ALSO defer to after-stop. Default here is
        // false to match "don't show text while recording — wait for stop".
        "kb.mic.liveText": false,

        // WHAT IS LEFT TO SPEND, so the mic can say so before the user does.
        //
        // The 429 on the transcribe route is the authority and stays the
        // backstop; this is here because being refused AFTER saying a sentence
        // is a worse way to learn it than being told when you reach for the
        // button. Absent for an anonymous caller, and then the mic behaves
        // exactly as it always did.
        //
        // `exhausted` is the only one the keyboard has to act on: true means
        // send them to the words screen instead of opening the microphone.
        // `low` is for a quieter mark on the key — a warning, not a stop.
        ...(opts.quota
          ? {
              "kb.quota.remaining": Math.max(0, Math.round(opts.quota.remaining)),
              "kb.quota.total": Math.max(0, Math.round(opts.quota.total)),
              "kb.quota.exhausted": !opts.quota.entitled && opts.quota.remaining <= 0,
              // A share of the ceiling with a fixed floor, both tunable in
              // WORDS_GATE — see the note there on why "nearly out" needs to
              // be worth about one message rather than a flat percentage.
              "kb.quota.low":
                !opts.quota.entitled
                && opts.quota.remaining > 0
                && opts.quota.remaining <= Math.max(
                  WORDS_GATE.lowFloor,
                  Math.round(opts.quota.total * WORDS_GATE.lowShare),
                ),
              /** Where to send them when it is gone. A screen id the app
               *  deep-links to, so changing the destination needs no build. */
              "kb.quota.screenId": WORDS_GATE.outScreenId,
              /** What the keyboard says when it cannot open the app at all. */
              "kb.quota.status": WORDS_GATE.keyboardStatus,
            }
          : {}),

        // ------- Typing engine (K4+ binaries; older builds ignore all of it) --
        //
        // These are the "close the native-keyboard gap" knobs. Every one has a
        // conservative Swift default (autocorrect/suggestions/bias default OFF
        // in the binary), so THIS block is the rollout switch — flip any of
        // them off here to kill the feature OTA, no rebuild.
        //
        // Press-order rollover: a second finger down commits the still-held
        // key immediately, so overlapped two-thumb presses land in press order
        // ("the", not "teh"). Matches the system keyboard's rollover.
        "kb.keyPlane.rolloverCommit": true,
        // COMMIT ON TOUCH-DOWN. The letter is inserted when the finger lands,
        // not when it lifts.
        //
        // Everything else about a press already happened on the way down — the
        // key lights, the click sounds, the haptic fires — and only the
        // character waited for the lift. A tap holds a key for 60 to 120 ms,
        // so the letter trailed its own keypress by three to seven frames on
        // every single press. That is the lag, and no work taken out of the
        // keystroke path could ever have closed it, because the delay was the
        // user's own finger.
        //
        // Keys with an accent tray are excluded client-side: there the hold has
        // to be ruled out before anything can be typed.
        //
        // Sent true, read with a false default, so old binaries are untouched
        // and a bad one can be taken back by changing this word.
        "kb.keyPlane.commitOnDown": true,
        // Accent long-press trays routed through the multi-touch plane (the
        // v1 plane dropped them; K4 restores them plane-side).
        "kb.keyPlane.accentTrays": true,
        // On-device autocorrect at word boundaries (space/return/punctuation):
        // UITextChecker guesses re-ranked by PHYSICAL key adjacency from the
        // live layout — a candidate that differs only by neighbor-key
        // substitutions is a fat-finger, not a different word. The typed
        // original shows as a suggestion chip for one-tap revert.
        "kb.autocorrect.enabled": true,
        "kb.autocorrect.minLen": 3,
        "kb.autocorrect.maxDistance": 2,
        // The word-suggestion strip is OFF by owner decision: autocorrect
        // stays exactly as it is, the row of guesses above the keys goes.
        //
        // Android keeps it for now, and only for now. Its autocorrect fed off
        // the same spell-check request the strip triggered, so hiding the
        // strip there silently turned autocorrect off as well; that is fixed
        // in the Android keyboard but needs a build to reach devices. Until
        // that build ships, Android is served the strip; then this becomes a
        // plain `false` for both.
        "kb.suggestions.enabled": opts.platform === "android",
        "kb.suggestions.max": 3,
        // Language-model hit-target bias — the cheap version of Apple's
        // dynamic key resizing. After typing a character, the letters likely
        // to FOLLOW it (table below) claim lmBias.pt extra points of the
        // ambiguous gap/slop zone around them. Direct hits inside a key's
        // real bounds are never stolen.
        //
        // OFF. The table below is ENGLISH bigram frequency, and it is the only
        // table there is — so for anyone typing Hinglish, Hindi, Tamil or any
        // of the other languages this product exists to serve, it biases
        // ambiguous taps toward letters that are not likely at all. It is also
        // unproven: nothing in the telemetry says it ever helped, and it can
        // only ever change which letter an uncertain tap produces. That is the
        // exact shape of "the keyboard typed something I didn't press".
        //
        // Both flags stay live, so this is one backend edit to re-enable — and
        // the honest way to turn it back on is per-language tables plus the
        // revert counter showing it wins, not an assumption that it does.
        "kb.touch.lmBias.enabled": false,
        "kb.touch.lmBias.pt": 0,
        // prev-char → likely next letters, most likely first (top-6, English
        // corpus bigram frequencies). The " " row is word-START letter
        // frequency, so the bias works on the first letter of every word too.
        "kb.touch.bigrams": {
          " ": "taoswcbp",
          "a": "ntsrlc",
          "b": "elouar",
          "c": "oheatk",
          "d": "eioasu",
          "e": "rnsdal",
          "f": "oierau",
          "g": "ehoari",
          "h": "eaiotu",
          "i": "nstocl",
          "j": "uoaei",
          "k": "einsal",
          "l": "eiloay",
          "m": "eaoiup",
          "n": "gdetos",
          "o": "nurfmt",
          "p": "eroali",
          "q": "u",
          "r": "eoiast",
          "s": "teosai",
          "t": "heioar",
          "u": "rnstlp",
          "v": "eiaoyu",
          "w": "aiheon",
          "x": "ptcaie",
          "y": "oestia",
          "z": "eaioyz",
        },
        // ------- Touch spaces (K5+ binaries) — native-style key reach -------
        //
        // Every key owns the space AROUND it, not just its painted rect, and
        // real controls (shift/delete/space/return/mic/tone/chips) veto that
        // reach so nothing is ever stolen from them.
        //
        // Vertical reach beyond each key's rect. The 10pt row gaps are fully
        // covered from both sides; the nearest row wins (dx+dy scoring).
        // Paint what the plane owns, on the device, in colour. Off by default.
        // Four rounds of reasoning about this geometry produced four wrong
        // answers; "it feels dead here" and "the rect does not reach here"
        // cannot be reconciled by argument, only by looking.
        // ON, temporarily. A build carrying the touch partition is installed
        // and reports feeling unchanged — which either means the partition is
        // not in that binary, or it is and the geometry is still wrong. Those
        // two look identical from the outside and no amount of reading the
        // code separates them. The overlay does, in one screenshot:
        //
        //   green   what each key owns (the partition)
        //   white   the key's painted rect
        //   red     controls that veto the plane
        //   orange  shift / layer keys
        //   blue    the outer band the fallback is bounded by
        //
        // If the bottom row has green boxes, the partition is live and we are
        // arguing about geometry. If it does not, the binary predates it.
        // Back to false once we know.
        // Draws the partition: obstacles filled, role keys stroked, the band
        // stroked. A dead gap sitting inside a filled obstacle is the veto; a
        // dead gap outside the band is the band being too short.
        //
        // Off. Beyond being visible to users, this one is not free: it marks
        // setNeedsDisplay() on every layout, draw() calls ensureFrames(), and
        // with alwaysRefresh that was a full geometry rebuild per frame in a
        // process iOS keeps on a short leash.
        "kb.debug.showTouchRects": false,
        // Raised from 8. Each side of a 10pt row gap contributed 8, so the gap
        // was covered — IF both neighbours' boxes are what govern it. 12 means
        // one side alone covers the whole gap, so the coverage no longer
        // depends on that assumption holding.
        "kb.touch.vSlop": 12,
        // The TOP letter row (q..p) reaches further UP toward the tools row —
        // overshooting the top row still types.
        //
        // 52, not 16, because 16 left a 46pt band across the whole keyboard
        // that belonged to no key at all. The server puts 52pt above the first
        // letter row — 8pt of container padding plus the 44pt tools row — and
        // the letter grid's touch band began 16pt above q, so everything from
        // the top edge down to 46pt resolved to nothing. That band is the
        // width of the keyboard and it is exactly where a thumb reaching for
        // the number row lands.
        //
        // Nothing is stolen by this. It is a touch-only value, so the keyboard
        // looks identical, and the mic, the tone pill and every other control
        // in the tools row are protected by the obstacle veto that runs before
        // the grid is consulted. What changes is the leftovers: the space
        // BETWEEN those controls used to type nothing and now types the letter
        // above which it sits.
        "kb.touch.topRowUpSlop": 52,
        // The BOTTOM letter row (z..m) reaches further DOWN toward the space
        // row; the space/return/123 keys themselves are veto-protected.
        "kb.touch.bottomRowDownSlop": 14,
        // Each row's outermost key owns its side margin to the keyboard edge —
        // the dead corners beside "a" and "l" on the indented middle row now
        // type "a" / "l", exactly like native.
        "kb.touch.edgeToMargin": true,
        // Space-bar trackpad (native hold-for-cursor). These are the Swift
        // defaults, pinned here so the behavior is explicit + OTA-tunable.
        // K5 fixed the bug where entering trackpad mode remounted the tree and
        // cancelled its own gesture — hold-space now scrubs the cursor like
        // the system keyboard, with keys dimming while active.
        "kb.trackpad.enabled": true,
        "kb.trackpad.longPressMs": 300,
        "kb.trackpad.ptPerChar": 7,
        // Space/return on the 123/#+= layer flips back to letters (native
        // behavior; K6+). false = stay on the symbol layer.
        "kb.layer.returnAfterSpace": true,

        // ------- K7: swipe typing + role keys + smarter corrections --------
        //
        // QuickPath-style glide typing. Both binaries default OFF; this is the
        // rollout switch, and it drives BOTH platforms. Trail is the fading ink
        // line behind the finger.
        //
        // OFF until it is measured. It was reported wrong on iOS, and the fix —
        // decode by path geometry against a real dictionary — has never run on
        // a device. Shipping it on while the same feature is held back on
        // Android for being unproven was not a judgement, it was an oversight:
        // the unproven one was the one users had.
        //
        // A swipe that guesses wrong costs far more trust than no swipe. Turn it
        // on for a cohort once a build has been used and swipeCommitted /
        // autocorrectReverted say it earns its place.
        "kb.swipe.enabled": false,
        "kb.swipe.minKeys": 3,
        "kb.swipe.maxAlternates": 3,
        "kb.swipe.trail.color": "#E8A23CD9",   // brand amber, mostly opaque
        "kb.swipe.trail.width": 7,
        "kb.swipe.trail.fadeMs": 260,
        // OTA lexicon extension — appended to the embedded frequency list.
        // Push product / domain vocabulary here without a rebuild.
        "kb.swipe.extraWords": ["tailzu", "tulmi"],
        // Shift + layer keys ride the touch plane (K7): shift arms on touch-
        // down and supports slide-to-letter one-shot capitals; 123/#+=/ABC
        // switch instantly on touch-down and support press-slide-release
        // layer-peek. Both individually OTA-reversible.
        "kb.keyPlane.shift": true,
        "kb.layerPeek.enabled": true,
        // Backspace immediately after an autocorrect restores the original.
        "kb.autocorrect.backspaceRevert": true,
        // Real-word confusion pairs — the word is spelled correctly, so the
        // alternatives are OFFERED as chips (tap swaps in place), never
        // auto-applied. Both directions listed explicitly.
        "kb.autocorrect.confusables": {
          "their": ["there", "they're"],
          "there": ["their", "they're"],
          "theyre": ["they're"],
          "your": ["you're"],
          "youre": ["you're"],
          "its": ["it's"],
          "whose": ["who's"],
          "were": ["we're", "where"],
          "where": ["were", "wear"],
          "then": ["than"],
          "than": ["then"],
          "to": ["too", "two"],
          "too": ["to", "two"],
          "affect": ["effect"],
          "effect": ["affect"],
          "lose": ["loose"],
          "loose": ["lose"],
          "weather": ["whether"],
          "whether": ["weather"],
          "accept": ["except"],
          "except": ["accept"],
          "advice": ["advise"],
          "advise": ["advice"],
        },

        // How often the keyboard re-reads host-field traits (return-key label,
        // language, multi-keyboard) from textDidChange. They only change on
        // focus switches, yet the reads are host-process round-trips that were
        // firing per keystroke. 0 restores per-keystroke reads.
        "kb.host.traitRefreshMs": 500,
        // Explicit keyboard height (pt). Locks the height the current tree
        // already renders at (spec: docs/keyboard-spec.md) instead of
        // inheriting whatever the system picks. Remove to fall back to the
        // system default sizing.
        "kb.height.pt": 272,
        // Native scales the keyboard with the phone; one constant cannot. This
        // table is what K17+ binaries actually use — first bucket whose
        // maxWidth >= the screen width wins, kb.height.pt above is the
        // fallback for older builds.
        //
        // Derived from the row arithmetic in the tree below:
        //   height = padTop + toolsRow + 4×(rowGap + rowHeight) + padBottom
        // so if you change kb.geometry.* you must re-derive these, or the
        // rows and the frame stop agreeing and the bottom row gets clipped.
        //   ≤375  (SE, mini)      8 + 44 + 4×(9+40)  + 4 = 252
        //   ≤413  (13/14/15, Pro) 8 + 44 + 4×(10+42) + 4 = 264
        //   >413  (Plus, Max)     8 + 44 + 4×(11+44) + 4 = 276
        "kb.height.byWidth": [
          { maxWidth: 375, height: 252 },
          { maxWidth: 413, height: 264 },
          { maxWidth: 9999, height: 276 },
        ],
      };

      // Mic media: OWNER DECISION — the keyboard's IDLE mic is always the
      // static brand mark baked into the binary. The media-registry
      // mic.animation upload is for the in-app mic only and is deliberately
      // NOT exported as kb.mic.idleIcon / kb.mic.idleIcon.url (doing so made
      // the keyboard mic play the GIF at idle). Only the recording art is
      // still pushed; it shows exclusively while audio is being captured.
      const reg = getMediaRegistryFn?.() ?? {};
      const micRecording = reg["mic.animation.recording"];
      if (micRecording?.url) {
        flags["kb.mic.recordingIcon"] = { url: micRecording.url };
        flags["kb.mic.recordingIcon.url"] = micRecording.url;
      }

      // Personality quick-swap: the user's pinned presets (max 6) render as
      // a chip row above the keyboard rows. Each chip carries the preset id
      // + a display emoji + a short name; tapping it sets the active
      // preset for subsequent refine calls. The active preset id is passed
      // through too so the current chip can highlight without an extra
      // fetch.
      //
      // NOBODY PINNED YET GETS EXACTLY ONE TONE, and it is Zu.
      //
      // The row used to be empty until the first pin, which handed the
      // keyboard back to its own built-in tone cycle — a set of names nobody
      // chose, on a control that is supposed to be the user's. A new keyboard
      // now carries one voice: ours, doing the ordinary thing. Adding a voice
      // in Voices replaces it with what they picked, which is the moment the
      // control becomes theirs and reads as an answer to something they did.
      const pinnedIds = Array.isArray(personality?.pinnedPresetIds)
        ? personality!.pinnedPresetIds!
        : [];
      const chips = pinnedIds.length > 0
        ? pinnedIds
            .map((id) => PERSONALITY_PRESETS.find((p) => p.id === id))
            .filter((p): p is (typeof PERSONALITY_PRESETS)[number] => !!p)
            .slice(0, MAX_PINNED_PRESETS)
            .map((p) => ({ id: p.id, name: p.name, tone: p.defaultTone }))
        : [HOUSE_TONE];
      // A pin list of ids that no longer resolve — voices deleted since —
      // would otherwise send an empty row and drop the keyboard back to its
      // own cycle. One tone is the floor, whatever the reason for the gap.
      flags["kb.personality.pinned"] = chips.length ? chips : [HOUSE_TONE];
      if (personality?.activePresetId) {
        flags["kb.personality.activeId"] = personality.activePresetId;
      }
      if (personality?.activeTone) {
        flags["kb.personality.activeTone"] = personality.activeTone;
      }
      // The user's own dictionary — names, brands, jargon. The keyboard biases
      // swipe decoding and autocorrect toward these; a generic lexicon will
      // never contain a colleague's name, and "fixing" it is exactly the kind
      // of wrong correction that costs trust.
      if (personality?.vocabulary?.trim()) {
        flags["kb.personality.vocabulary"] = personality.vocabulary.trim().slice(0, 4000);
      }
      // Haptics the user chose, in the shape the keyboards read: a master
      // switch and a set of individual keys. Kept INDEPENDENT — turning the
      // master off must not discard the keys someone picked one by one.
      if (personality?.hapticsAll) flags["kb.haptics.all"] = true;
      if (personality?.hapticKeys?.length) {
        const keys: Record<string, boolean> = {};
        for (const k of personality.hapticKeys.slice(0, 128)) {
          const id = String(k).toLowerCase();
          if (id) keys[id] = true;
        }
        flags["kb.haptics.keys"] = keys;
      }
      // Fast-tone list for the long-press tone sheet (iOS + Android read
      // `kb.personality.tones`). Rich `{ id, label }` shape so the clients apply
      // the exact tone id (→ per-tone refine) and the labels/order/set are fully
      // backend-controlled — rename, reorder, or add a tone with no app update.
      flags["kb.personality.tones"] = (
        Object.keys(TONE_LABELS) as Array<keyof typeof TONE_LABELS>
      ).map((id) => ({ id, label: TONE_LABELS[id] }));
      // Staged rollout LAST, so an experiment can override anything above.
      // Keyed on the user id, so a user's slice is stable across requests —
      // settings must never flip under their fingers mid-sentence.
      return applyRollouts(flags, userId, activeRollouts());
    })(),
    // Was 600 (10 min). A live theme fix couldn't reach users mid-session.
    // 60 s keeps cost negligible and lets themed rollouts hit within a minute.
    cacheTtlSeconds: 60,
  };
}
