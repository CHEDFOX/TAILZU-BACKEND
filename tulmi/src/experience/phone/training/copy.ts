/**
 * The Training tab's words, gaps and media slots, and how flow behaves around it.
 */

import type { ActionRef } from "../../../../../shared/types/sdui.js";
import { ACCENT_AMBER } from "../palette.js";

/**
 * THE CONVERSATION GETS THE MICROPHONE TO ITSELF.
 *
 * On iPhone the keyboard's background session (Flow) holds a microphone
 * engine of its own, armed at every launch (kb.flow.armOnForeground). The
 * spoken training screen opens a second one the moment its greeting ends,
 * and when the two meet, the conversation's can come up recording silence:
 * the greeting is spoken, nothing the person says is ever heard, and the
 * screen waits for a pause that never comes. So Flow is stood down on the
 * way in and armed again on the way out, however the screen is left. Android
 * never arms Flow, so neither step runs there.
 */
export const QUIET_FLOW_FOR_TRAINING: ActionRef = { kind: "condition", if: { platform: "ios" }, then: { kind: "endFlowSession" } };
export const REARM_FLOW_AFTER_TRAINING: ActionRef = {
  kind: "condition",
  if: { all: [{ platform: "ios" }, { flag: "kb.flow.armOnForeground" }] },
  then: { kind: "armFlowSession" },
};

export const TRAINING_UI = {
  entry: {
    /**
     * How far back the field sits behind the copy. It is the art here, not
     * the subject — the title and the control have to read over it — so it is
     * dimmed rather than blurred: blurring a network turns it into weather,
     * and the point is that you can see it is a network.
     */
    fieldDim: 0.55,
    /** Tiny, tracked, uppercase — the line above the title. "" removes it. */
    kicker: "IT LEARNS YOU",
    kickerSize: 9.5,
    kickerTracking: 3,
    /**
     * BRIGHT WHITE, over a title in pale ink.
     *
     * The usual arrangement — a dimmed kicker over a white headline — makes the
     * small line a caption on the big one. Here the two lines are a pair:
     * white states the claim, the warm pale title answers it. Not amber —
     * nothing on this screen is live.
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
     * Pale ink, the warm neutral of the palette — NOT the brand amber, which
     * is reserved for what is live (recording, listening), and NOT
     * THEME.color.primary, which is plain white on this black surface.
     */
    titleColor: "#F3E2C6",
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
      /**
       * IT NAMES THE GESTURE, because the gesture is the one thing about this
       * control nobody can see. "BEGIN" is a button's word — it says what
       * happens and leaves the disc, the run and the far end unexplained, so
       * the pill reads as a button that does not answer a press.
       */
      label: "SLIDE TO BEGIN",
      /**
       * SMOKED GLASS, NOT A BLACK SLAB.
       *
       * A near-black pill on a black field is a rectangle of nothing with a
       * bright dot at one end — the control had no shape of its own, only the
       * disc's. Warm and translucent, it sits ON the network instead of
       * cutting a hole in it, and the hairline is what gives it an edge over
       * moving art.
       */
      background: "rgba(20,17,14,0.62)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.12)",
      color: "#FFFFFF",
      fontSize: 12.5,
      /** Bold. This is the way into the product, not a caption on it. */
      weight: "800",
      tracking: 2.2,
      height: 58,
      radius: 999,
      /** The disc that travels. Starts on the LEFT. Plain — nothing drawn
       *  inside it; set `dot` above 0 to put a mark back. */
      disc: 46,
      /** Glass, and deliberately NOT the target's solid pale: this is the
       *  thing in your hand, and the solid is where it is going. Two of the
       *  same and the journey has no direction. */
      discBackground: "rgba(255,255,255,0.20)",
      dot: 0,
      dotColor: "#FFFFFF",
      /** Where it lands, in pale ink now that the pill is glass rather than
       *  black — it brightens as the disc approaches, so the end of the
       *  journey is visible from the start of it. Not amber: nothing here is
       *  live yet. */
      targetBackground: "#F3E2C6",
      targetDotColor: "#000000",
      /** How far along counts as committed, as a share of the run. */
      threshold: 0.62,
      /** How long the disc takes to cross the WHOLE pill once committed. The
       *  renderer scales it by the distance left, so a tap — which has the
       *  furthest to go — no longer arrives fastest. */
      commitMs: 460,
      /** When the disc nudges itself to advertise the drag. 0 removes the
       *  hint — and with it, most people's chance of finding the gesture. */
      hintDelayMs: 1250,
      /** Breathing room either side of the pill. */
      inset: 22,
    },
  },
  /**
   * WHAT IT KNOWS — the panel under the button.
   *
   * The first screen is the field, two words and the way in, and it stays
   * that: a screen you look at. The evidence lives one scroll below it, on a
   * sheet that rises OVER the network and blurs it — so the network is the
   * ground the whole tab stands on rather than a picture at the top of it.
   *
   * Everything here is counted from the portrait, which is the only honest
   * source: it is literally what the app has learned. Nothing is smoothed and
   * nothing is invented, so a new account sees small numbers rather than a
   * chart of nothing.
   */
  stats: {
    sheetRadius: 26,
    sheetBlur: 34,
    sheetTint: "dark" as const,
    /** Over the blur. A blur alone leaves the brightest fibres reading
     *  through the type; this is what makes the sheet a surface. */
    wash: "rgba(9,8,7,0.82)",
    padding: 22,
    /** Clears the docked tabs at the bottom of the scroll. */
    bottom: 132,
    kicker: "WHAT IT KNOWS",
    kickerSize: 9,
    kickerTracking: 3,
    ring: 150,
    ringThickness: 22,
    text: "#FFFFFF",
    textDim: "rgba(255,255,255,0.56)",
    textFaint: "rgba(255,255,255,0.34)",
    tile: "rgba(255,255,255,0.055)",
    tileRadius: 14,
    tileGap: 8,
    chip: "rgba(255,255,255,0.07)",
    chipRadius: 999,
    /** How many of their own words are shown. The rest are still learned. */
    chipLimit: 8,
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
      // Pale ink, not amber: a note on the thread is not something live.
      noteText: "#F3E2C6",
      noteBg: "rgba(243,226,198,0.1)",
      noteBorder: "rgba(243,226,198,0.26)",
      variantBg: "rgba(255,255,255,0.05)",
      variantBorder: "rgba(255,255,255,0.1)",
      variantText: "rgba(255,255,255,0.92)",
      angleText: "rgba(255,255,255,0.4)",
      pickedBg: "rgba(243,226,198,0.13)",
      pickedBorder: "#F3E2C6",
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
      /**
       * WHAT IT SAYS THE MOMENT THE SESSION OPENS.
       *
       * The screen used to open by LISTENING. Nothing was said, nothing
       * happened, and the first thing the app ever said arrived only after the
       * user had spoken into silence and waited out a round trip — so the
       * feature's first impression was a pause long enough to read as broken.
       *
       * These cost nothing, because they are not asked for. The server already
       * knows who this is and what it has learned of them, so the greeting is
       * composed here and travels with the screen. It is spoken while the
       * microphone and the socket are still opening, which is what turns the
       * warm-up into the greeting instead of a wait before one.
       *
       * `{name}` and `{word}` are filled in when there is one; a line naming
       * something it has not got is never chosen.
       */
      greeting: {
        /** Nothing learned yet — say what is about to happen. */
        first: [
          "I don't know how you sound yet. Just talk, and I'll listen.",
          "This is the part where I learn your voice. Start anywhere.",
        ],
        /** Some evidence, not much. */
        early: [
          "I've got a little of you so far. Keep going.",
          "A few of your words are mine now. Let's get more.",
        ],
        /** Enough that naming it is true. */
        known: [
          "Back for more. I've been getting the hang of you.",
          "I know some of how you talk now. Let's sharpen it.",
        ],
        /** Used when a real learned word is available — the strongest proof
         *  that it has been paying attention. */
        withWord: [
          "Last time I picked up \u201c{word}\u201d. Say more like that.",
          "\u201c{word}\u201d stuck with me. Keep talking.",
        ],
        /** Prefixed when a name is known. Its own value so it can be dropped
         *  without rewriting every line above. */
        withName: "{name} \u2014 ",
      },
      end: "End & save",
      saving: "Reading the conversation",
      saved: "It knows you a little better.",
      /**
       * THE LAST THING THE SCREEN SAYS, and it turns over as it says it.
       *
       * Ending used to be a toast and a jump home — the one moment the app has
       * to show that the conversation went somewhere, spent on a grey rectangle
       * sliding in from the top. Three words, in the middle of the field, each
       * turning into the next while the portrait is actually being written.
       *
       * They are in the order the work happens: it heard you, it learned from
       * it, what it learned is yours. Nothing here is a status — the save is
       * what takes the time, and these are what the time is FOR.
       */
      farewell: {
        words: ["Heard.", "Learned.", "Yours."],
        intervalMs: 1000,
        flipMs: 560,
        size: 34,
        weight: "800",
        tracking: -0.6,
        color: "#FFFFFF",
        /** How long the last word is held after the save lands, ms. */
        holdMs: 1500,
      },
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
