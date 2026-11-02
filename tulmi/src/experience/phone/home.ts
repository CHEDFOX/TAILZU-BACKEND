/**
 * The Home tab.
 */

import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import type { ScreenContext } from "../screens.js";
import { FILL_STYLE } from "./layout.js";
import { neuralField, fieldGrowth, FIELD_SIGNAL_AT_REST } from "./neuralField.js";
import { CHART_ON_DARK } from "./palette.js";
import { settingsGear } from "./parts.js";
import { type Slice, pieNode } from "./pie.js";
import { TRAINING_UI, QUIET_FLOW_FOR_TRAINING } from "./training/copy.js";

/**
 * The Training tab's front door: the art, one line, and the ways in.
 *
 * The refine loop did not shrink — it moved one tap deeper, to training_chat,
 * intact. What this screen buys is a place for the media and a choice that is
 * legible before anything is typed.
 */
export function homeScreen(ctx: ScreenContext): ScreenResponse {
  const ui = TRAINING_UI.entry;
  const st = TRAINING_UI.stats;

  // ------------------------------------------------------------ what it knows
  //
  // Counted off the style portrait, which is not a metric about the app — it
  // IS what the app has learned of this person. Every number below is a thing
  // it can point at: a word of theirs, a mode it has seen them write in, a
  // sitting it learned from.
  const n = (v: number) => Math.max(0, Math.round(v)).toLocaleString("en-US");
  // Days the person actually wrote. This is the evidence the portrait is built
  // from, which is why it belongs under the count of what the portrait holds.
  const perDay = ctx.stats?.wordsPerDay ?? ctx.stats?.sparklinePerDay ?? [];
  const sp = ctx.personality?.stylePortrait ?? {};
  const words = sp.words ?? [];
  const styles = sp.styles ?? [];
  const rhythms = sp.rhythms ?? [];
  const voices = Object.keys(sp.tones ?? {}).length;
  const known = words.length + styles.length + rhythms.length + voices;
  const sessions = sp.sessions ?? 0;
  const rounds = sp.examples ?? 0;
  const refines = sp.observed ?? 0;

  /**
   * WHETHER THIS TAB IS ALLOWED TO SCROLL AT ALL.
   *
   * Two conditions, and both are about not shipping a broken screen:
   *
   *  - a height, or the opening pane collapses and the sheet lands in the
   *    first view, which is the one thing this layout exists to prevent;
   *  - a Screen that holds its touches, because a scroll view cancels the
   *    touches inside it the moment its pan engages — and the way into this
   *    tab is a disc DRAGGED across a pill. Nobody draws that arc level, so on
   *    a bundle without it the drift handed the gesture to the scroll, the
   *    disc sprang home, and the slide did nothing.
   *
   * Without both, the tab is exactly what it was: one screen, no scroll, a
   * pill that works.
   */
  const scrollable = !!ctx.viewport &&
    (ctx.can?.has("ScreenHoldTouches") === true ||
     // A WINDOW HAS THE SECOND CONDITION FOR FREE.
     //
     // The reason for it is that a scroll view steals the touches of a child
     // being dragged. Nothing is dragged on a desktop: the pill there is a
     // click, because a mouse has no thumb to rest and the deliberateness the
     // gesture was protecting is already in a click on an object that size.
     //
     // Without this the window got the no-scroll layout, so the stats panel
     // below the fold did not exist on the one surface with the most room to
     // show it — the opposite of what the height was being read for.
     ctx.formFactor === "desktop");

  const slices: Slice[] = [
    { label: "Words", value: words.length, color: CHART_ON_DARK[0]! },
    { label: "Styles", value: styles.length, color: CHART_ON_DARK[1]! },
    { label: "Rhythms", value: rhythms.length, color: CHART_ON_DARK[2]! },
    { label: "Voices", value: voices, color: CHART_ON_DARK[3]! },
  ].filter((sl) => sl.value > 0);

  /** One counted thing. Three of them in a row, and no sentence between. */
  const tile = (label: string, value: number): Node => ({
    type: "Stack",
    style: {
      flex: 1, backgroundColor: st.tile, borderRadius: st.tileRadius,
      paddingVertical: 13, paddingHorizontal: 12,
    },
    children: [
      { type: "Text", props: { content: n(value) },
        style: { fontSize: 23, fontWeight: "800", letterSpacing: -0.9, color: st.text } },
      { type: "Text", props: { content: label },
        style: { fontSize: 8, letterSpacing: 1.8, textTransform: "uppercase",
                 color: st.textDim, marginTop: 4 } },
    ],
  });

  /**
   * WHAT IT HAS BEEN LEARNING FROM — a bar a day, newest at the right.
   *
   * The ring says what the app knows and the tiles say how much; neither says
   * when any of it happened, and "it gets better the more you write" is a
   * claim about TIME. This is the only shape on the tab that carries it: a
   * run of days, the gaps included, because a gap is information too.
   *
   * Today is the one at full strength. Not amber: amber is only for what is
   * live right now (recording, listening), and a bar of counted days is not.
   */
  const feed = (values: number[]): Node => {
    const max = Math.max(1, ...values);
    const last = values.length - 1;
    return {
      type: "Stack",
      style: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 44 },
      children: values.map((v, i) => ({
        type: "Stack",
        style: {
          flex: 1, borderRadius: 2,
          // A floor, so a day with nothing is a mark rather than a hole. The
          // row is a run of days; a missing bar reads as missing data.
          height: `${Math.max(7, Math.round((v / max) * 100))}%`,
          backgroundColor: st.text,
          opacity: i === last ? 1 : v === 0 ? 0.12 : 0.34 + (v / max) * 0.3,
        },
      })),
    };
  };


  const label = (content: string, top: number): Node => ({
    type: "Text", props: { content },
    style: { fontSize: st.kickerSize, letterSpacing: st.kickerTracking,
             textTransform: "uppercase", color: st.textFaint, marginTop: top,
             marginBottom: 12 },
  });

  // NOTHING LEARNED YET is a sentence, not a chart of zeros. A ring with no
  // slices and three tiles of 0 reads as a broken screen on the day someone
  // installs the app — which is the one day it has to read as an invitation.
  const panel: Node[] = known + sessions + refines === 0
    ? [
        label(st.kicker, 0),
        { type: "Text", props: { content: "Nothing learned yet." },
          style: { fontSize: 17, fontWeight: "700", color: st.text } },
        { type: "Text", props: { content: "Talk once and this fills in — your words, the way you build a sentence, the hours you write in." },
          style: { fontSize: 12, lineHeight: 18, color: st.textDim, marginTop: 6 } },
      ]
    : [
        label(st.kicker, 0),
        pieNode({
          slices, size: st.ring, thickness: st.ringThickness,
          legend: true, legendColor: st.textDim,
          centerValue: n(known), centerLabel: "learned",
          emptyLabel: "",
          style: { alignSelf: "center", marginBottom: 6, width: "100%" },
        }),
        {
          type: "Stack",
          style: { flexDirection: "row", gap: st.tileGap, marginTop: 14 },
          children: [
            tile("Sittings", sessions),
            tile("Rounds", rounds),
            tile("Refines", refines),
          ],
        },
        ...(perDay.some((v) => v > 0)
          ? [
              label("What it learns from", 22),
              feed(perDay.slice(-21)) as Node,
            ]
          : []),
      ];

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
          then: { kind: "sequence", actions: [QUIET_FLOW_FOR_TRAINING, { kind: "navigate", screenId: "training_live" }] },
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
        // THE FIELD, edge to edge, and it IS the art.
        //
        // The entry used to be an uploaded still under a blur and a tint. A
        // still cannot say the one thing this tab is about — that the thing
        // inside is alive and gets bigger every time you talk to it — so the
        // hero is the network itself, dimmed back to scenery so the title and
        // the control read over it. It is already firing before anyone
        // touches the screen, because it is already trained.
        neuralField(TRAINING_UI.entry.fieldDim, fieldGrowth(ctx.personality), undefined, FIELD_SIGNAL_AT_REST),
        // The scrim over it, and under everything else.
        {
          type: "Gradient",
          props: { colors: ui.scrim, locations: ui.scrimStops, direction: "vertical" },
          style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
        },
        // THE SCROLL, over a field that does not move.
        //
        // The first pane is exactly one window tall — the network, two words
        // and the way in, nothing else — so the tab still opens as a thing you
        // look at. What the app has learned is one scroll below it, on a sheet
        // that rises over the network and blurs it. The field never scrolls:
        // it is the ground, not the top of the page.
        {
          type: "Screen",
          // The scroll must not take the touch off the pill. See holdTouches.
          props: { holdTouches: true },
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0,
          },
          children: [
        {
          type: "Stack",
          // Both, and they answer the same question twice on purpose: the
          // number is exact and works on every installed bundle, the prop is
          // what keeps the pane right if the phone is ever rotated or split.
          // A bundle that knows neither still gets the opening view it always
          // had — see the guard on the sheet below.
          props: { fillViewport: true },
          style: {
            ...(scrollable ? { minHeight: ctx.viewport!.height } : {}),
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
                borderWidth: ui.cta.borderWidth,
                borderColor: ui.cta.borderColor,
                color: ui.cta.color,
                fontSize: ui.cta.fontSize,
                weight: ui.cta.weight,
                tracking: ui.cta.tracking,
                commitMs: ui.cta.commitMs,
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
            // THE SHEET, and ONLY when the pane above it can be a full window.
            //
            // Without a height for the opening view the pane collapses to its
            // content and this lands in the first screen — the tab opens on a
            // ring of numbers instead of on the field, which is the one thing
            // the layout exists to prevent. A phone that does not say how tall
            // it is keeps the tab exactly as it was.
            ...(scrollable ? [{
              type: "BlurBackground",
              props: { intensity: st.sheetBlur, tint: st.sheetTint },
              style: {
                borderTopLeftRadius: st.sheetRadius,
                borderTopRightRadius: st.sheetRadius,
                overflow: "hidden",
              },
              children: [
                { type: "Stack", style: { ...FILL_STYLE, backgroundColor: st.wash } },
                {
                  type: "Stack",
                  style: {
                    paddingHorizontal: st.padding, paddingTop: st.padding,
                    paddingBottom: st.bottom,
                  },
                  children: panel,
                },
              ],
            } as Node] : []),
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
