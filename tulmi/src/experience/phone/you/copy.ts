/**
 * The You tab's words and layout, and the header its screens share.
 */

import type { Node, ActionRef } from "../../../../../shared/types/sdui.js";
import { PHONE_LOOK, label, t } from "../../phoneLook.js";
import { ACCENT_AMBER } from "../palette.js";
import { GREET } from "../theme.js";

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
  /** The brand amber, for what is live right now (recording, listening) —
   *  which nothing on You or its sub-screens is, so nothing there uses it;
   *  the tests check for its absence by this name. */
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
  /**
   * ZU, ABOVE THE LIST.
   *
   * Zu is not the twelfth voice. The eleven are styles laid ON the writing;
   * Zu IS the writing, repaired — which is why its prompt is empty and must
   * stay empty. Sitting in the list it read as a peer of the styles, with an
   * Add that implied it could be absent and an Edit that invited a generic
   * sentence over the one voice that exists to assert nothing. It is lifted
   * out: always on the keyboard, never editable, above the styles.
   */
  selfVoice: {
    radius: 18,
    padding: 16,
    /** Amber only while Zu is the voice actually writing — the sacred rule. */
    liveBackground: "rgba(232,162,60,0.07)",
    liveBorder: "rgba(232,162,60,0.22)",
    restBackground: "#141418",
    kickerSize: 8.5,
    kickerTracking: 2.4,
    nameSize: 25,
    nameGap: 8,
    lineSize: 13,
    lineHeight: 18,
    dot: 7,
    marginBottom: 4,
  },
  /** A small action on a pill — Edit, Add, Remove, Save. */
  chip: {
    height: 28,
    radius: 999,
    paddingHorizontal: 13,
    fontSize: 10,
    tracking: 0.7,
    /** The quiet form: brand type on a brand wash. */
    /** A quiet chip is a white tint. A solid one is the accent, and there
     *  is at most one of those on a screen. */
    soft: "rgba(255,255,255,0.08)",
    /**
     * A SIGN, NOT A WORD.
     *
     * "Add" and "Remove" are two different lengths, so a list of voices had a
     * ragged right edge and every row's button had to be read before it could
     * be used. + and − are the same shape, in the same place, on every row:
     * one glance says which voices are on the keyboard and one tap changes it.
     */
    signSize: 30,
    signFontSize: 19,
    signWeight: "800",
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
  /**
   * THE PORTRAIT — the sentence at the top that says the whole setup.
   *
   * This tab is about a person. A person is read at a glance, the way a face
   * is, and the deck made you tap four times to learn four things. The
   * sentence says all of it in one line, in the display face, with the one
   * live thing — the voice actually writing — in the accent.
   */
  portrait: {
    size: 21,
    lineHeight: 26,
    /**
     * CLEAR OF THE GREETING, not tucked under it.
     *
     * The hello, the name and this sentence are three different things — a
     * label, a proper noun and a statement about the setup — and stacked at
     * two points apart they read as one dense clump of type in the corner.
     * The gap is what separates them into three facts.
     */
    marginTop: 184,
    marginBottom: 32,
  },
  /**
   * THE VOICE CARD — the one object on this tab, and the reason it has a
   * hierarchy at all.
   *
   * Four identical rows said the voice, the dictionary, the languages and the
   * haptics all matter the same amount. They do not. The voice is what this
   * tab is ABOUT — it is the thing writing as you — and the other three are
   * settings you adjust occasionally. So the voice gets an object with its
   * own art, its name in the display face, and the line that says how it
   * writes; the rest get rows.
   *
   * The tagline is the point. Every voice carries one and it has never been
   * on this screen: the name alone tells you which voice is on, and the line
   * tells you what that MEANS, which is the thing you actually wanted to know.
   */
  voiceCard: {
    /** The same height as the training card beneath it: two cards, one rhythm. */
    height: 220,
    /**
     * Its height when it wears a poster (you.voice.<id>). The poster carries
     * the voice's own sentence above the card's words, and 168 leaves no band
     * for one: the kicker starts 55% down. 220 does, at 1200×750.
     */
    posterHeight: 220,
    radius: 22,
    /** The card's own dark, a step up off the ground so it reads as an object
     *  on it rather than a panel cut into it. */
    background: "#17161A",
    border: "rgba(255,255,255,0.07)",
    /** A warm fall from the top — the light the art used to provide, in the
     *  app's own colour and the same on every account. */
    scrim: ["rgba(232,162,60,0.10)", "rgba(232,162,60,0.03)", "rgba(0,0,0,0)"],
    scrimStops: [0, 0.5, 1],
    padding: 20,
    kickerSize: 8,
    kickerTracking: 2.4,
    /** The biggest type on the tab. It is the answer to what the tab is for. */
    nameSize: 34,
    /** Air under the name. The two lines were touching, which made them one
     *  block of text instead of a name and a line about it. */
    nameGap: 9,
    taglineSize: 13,
    taglineLineHeight: 18,
    dot: 7,
    marginBottom: 20,
  },
  /**
   * THE TRAINING CARD — the Train tab, folded into You.
   *
   * Training is how the app learns this person, and You is the page about
   * that person, so it lives here now rather than as a tab of its own. The
   * card is the Train screen's own parts at card size: the live network it
   * grows, the two lines, what it has learned so far, and the same way in.
   *
   * The title is white, not amber: nothing on this tab is live, so nothing
   * on it is amber.
   */
  /**
   * DICTIONARY, LANGUAGES AND HAPTICS, AS CARDS. The same object as the
   * voice card and the training card, so the tab is one column of one shape:
   * a kicker, the value set large, and a line about it. A poster
   * (you.dictionary, you.languages, you.haptics) fills each when uploaded.
   */
  settingCard: {
    dictionaryLine: "Names and words it spells your way.",
    languagesLine: "Say it in any of them. It writes the way you type.",
    hapticsLine: "Feel every key as you type.",
    /** The value's size when it runs long (three languages, say). */
    longValueSize: 26,
    longAfter: 14,
  },
  trainCard: {
    height: 220,
    radius: 22,
    background: "#000000",
    border: "rgba(255,255,255,0.07)",
    /** The field sits a little further back here: the card is one object
     *  among several, not the whole window. */
    fieldDim: 0.5,
    scrim: ["rgba(0,0,0,0.05)", "rgba(0,0,0,0.35)", "rgba(0,0,0,0.78)"],
    scrimStops: [0, 0.45, 1],
    padding: 18,
    // ONE ODD LINE AND THE BUTTON. The kicker and the counts ("42 learned,
    // 27 sittings") read as a report card; the owner wanted a line worth
    // reading and a way in, nothing else.
    kicker: "",
    kickerSize: 8,
    kickerTracking: 2.4,
    // The card's name, in bold capitals, and what it says to you in the hand.
    title: "BIRZU",
    subtitle: "Hey Master, Make Me Like You",
    titleSize: 26,
    titleColor: "#FFFFFF",
    /** "{n} learned, {s} sittings"; "" hides the line. Hidden. */
    learned: "",
    /** Said instead, before anything has been learned. Hidden too. */
    learnedNone: "",
    learnedSize: 12,
    ctaHeight: 46,
    ctaGap: 14,
    /** The button's word when the card is a tap. "SLIDE TO BEGIN" belongs to
     *  the drag; on a button it names a gesture that is not there. */
    tapLabel: "Begin",
    marginBottom: 20,
    /**
     * A TAP, NOT A DRAG. The drag needs the screen to hold its touches, and
     * a screen that holds them cannot be scrolled by a finger that lands on
     * any card or row, which on this tab is nearly all of it. True brings the
     * drag back at that cost.
     */
    swipe: false,
  },
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
    // A dark note, not an amber one. The ring inside it carries the one
    // amber — its leading slice — and a note that was all amber drowned it.
    background: "#141418",
    /** Ink on the amber. Black, and mid-weight — not bold, which on a solid
     *  colour reads as shouting rather than as speech. */
    text: "#FFFFFF",
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
      // THE ONE AMBER ON THE YOU TAB. The note is dark now, so the way into
      // the screen it describes is the solid thing on it — the single control
      // here that opens something.
      background: ACCENT_AMBER,
      text: "#0B0B0D",
    },
  },
};

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
      backgroundColor: "rgba(255,255,255,0.08)",
    },
    children: [{
      type: "SVG",
      props: {
        viewBox: "0 0 24 24", d: "M14.5 5 L8 12 L14.5 19",
        fill: "none", stroke: u.text, strokeWidth: 2.3,
        strokeLinecap: "round", strokeLinejoin: "round",
      },
      style: { width: 14, height: 14 },
    }],
  };
}

/** A round control on the amber block — the ＋ at the top right of Voice. */
export function youHeadIcon(d: string, onPress: ActionRef): Node {
  const u = YOU_UI;
  return {
    type: "Stack",
    on: { onPress },
    props: { pressOpacity: 0.55, hitSlop: u.head.controlSlop },
    style: {
      width: u.head.controlSize, height: u.head.controlSize,
      borderRadius: u.head.controlSize / 2,
      alignItems: "center", justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.08)",
    },
    children: [{
      type: "SVG",
      props: {
        viewBox: "0 0 24 24", d,
        fill: "none", stroke: u.text, strokeWidth: 2.3,
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
export function youHead(kicker: string, title: string, right?: Node): Node {
  const u = YOU_UI;
  return {
    type: "Stack",
    style: {
      // The ground, not the accent. A full amber slab at the top of every
      // sub-screen was the accent as wallpaper; the way back and the title
      // read as well on black, and the amber is kept for the one control on
      // the screen that changes something.
      backgroundColor: u.ground,
      paddingTop: u.head.paddingTop,
      paddingBottom: 20,
      paddingHorizontal: PHONE_LOOK.side,
      borderBottomLeftRadius: u.head.radius,
      borderBottomRightRadius: u.head.radius,
    },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
        children: [youBack(), ...(right ? [right] : [])],
      },
      // The refresh: a small mono kicker and the title (below).
      label(kicker, { marginTop: 18 }),
      // The page title in the onboarding's heading face (touches.ts).
      t(title, "grotesk", 26, { letterSpacing: -0.6, marginTop: 8 }),
    ],
  };
}


/** A section label on the black ground. Small, spaced, never a heading. */
export function youLabel(content: string): Node {
  // The refresh's label: small mono, with air above it (phoneLook.ts).
  return label(content, { marginTop: 32, marginBottom: 12 });
}
