/**
 * History: everything written, by day.
 */

import type { HistoryEntry } from "../../../../shared/types/api.js";
import { type ScreenResponse, type ActionSpec, type ActionRef, type Node, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { label, t, caption } from "../phoneLook.js";
import type { ScreenContext } from "../screens.js";
import { sw } from "../settingsWords.js";
import { blipPicture } from "../touches.js";
import { readable } from "./layout.js";
import { CHART_ON_DARK } from "./palette.js";
import type { Slice } from "./pie.js";
import { STATS_UI } from "./stats.js";

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
function historyBreakdown(entries: HistoryEntry[] | undefined): Slice[] {
  const rows = entries ?? [];
  if (rows.length === 0) return [];
  const spoken = rows.reduce((n, e) => n + (e.wordsIn ?? 0), 0);
  const written = rows.reduce((n, e) => n + (e.wordsOut ?? 0), 0);
  if (spoken === 0 && written === 0) return [];
  // The chart's own colours, sent with the data. Without them the renderer
  // reaches for its default palette, which is the one thing on this screen
  // that would not be the Stats ground it was opened from.
  return [
    // No amber inside History (owner's call): the written half is the full
    // pale, the spoken half the faint one.
    { label: "Written", value: written, color: STATS_UI.ink },
    { label: "Spoken", value: spoken, color: CHART_ON_DARK[3]! },
  ];
}

export function historyScreen(ctx: ScreenContext): ScreenResponse {
  // Opened from Stats, so it wears the Stats ground. See STATS_UI.
  const u = STATS_UI;
  const deleteFor = (reason: "not_me" | "cleanup"): ActionSpec => ({ kind: "sequence", actions: [
    { kind: "setState", path: "askDelete", value: false },
    {
      kind: "callEndpoint",
      method: "DELETE",
      path: `/v1/history/$state.item.id?reason=${reason}`,
      onSuccess: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "refresh" },
      ] },
      onError: "err",
    },
  ] });
  /** The question's buttons: small type, like the training card's. */
  const choice = (text: string, action: ActionRef, keep = false): Node => ({
    type: "Button",
    props: {
      label: text, variant: keep ? "primary" : "secondary",
      labelColor: keep ? u.ground : u.onCard, fontSize: 12, fontWeight: "600", tracking: 0.3,
      paddingVertical: 0, paddingHorizontal: 18, radius: 12,
    },
    on: { onPress: action },
    style: { height: 44, ...(keep ? { backgroundColor: u.onCard }
      : { backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(243,226,198,0.28)" }) },
  });
  /** Asked before a card goes. In the row, so it reads the row's own item. */
  const askWhy: Node = {
    type: "Modal",
    bind: { open: "askDelete" },
    props: { blur: true, blurIntensity: 30, blurTint: "dark" },
    on: { onDismiss: "keepEntry" },
    style: { backgroundColor: u.card, borderRadius: 22, padding: 22, width: "88%" },
    children: [
      label("Remove from history", { color: u.onCardDim }),
      t("Why should it go?", "writtenLight", 22, { marginTop: 12, letterSpacing: -0.3 }),
      caption("Either way it's gone for good, and X0 Bot stops learning from it.",
        { marginTop: 10, color: "rgba(243,226,198,0.72)" }),
      {
        type: "Stack",
        style: { gap: 10, marginTop: 22 },
        children: [
          choice("It Doesn't Sound Like Me", "deleteNotMe"),
          choice("Just A Clean-Up", "deleteCleanup"),
          choice("Leave It", "keepEntry", true),
        ],
      },
    ],
  };
  /** The × in a card's corner. */
  const cross: Node = {
    type: "Stack",
    on: { onPress: "askDelete" },
    props: { pressOpacity: 0.55, hitSlop: 12 },
    style: {
      position: "absolute", top: 10, right: 10, width: 26, height: 26, borderRadius: 13,
      alignItems: "center", justifyContent: "center", backgroundColor: "rgba(243,226,198,0.07)",
    },
    children: [{
      type: "SVG",
      props: { viewBox: "0 0 24 24", d: "M7 7 L17 17 M17 7 L7 17",
               fill: "none", stroke: u.onCardDim, strokeWidth: 2.4 },
      style: { width: 9, height: 9 },
    }],
  };
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "history",
    title: "History",
    // Its own ground and its own way back: History is opened FROM Stats, and
    // the default header paints the theme black over the Stats ground, which
    // reads as a seam across the top of the screen.
    hideHeader: true,
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
      // Tap on a card copies what Tailzu wrote. It used to toast a stub
      // ("Detail view coming soon"), and by its label key at that: a phone's
      // toast does not look labels up, so "@history.detail.toast" is what
      // people saw. A build that cannot fill a row's text into the clipboard
      // (no "ActionText") gets the touch and nothing else, never a
      // placeholder.
      openDetail: ctx.can?.has("ActionText")
        ? { kind: "sequence", actions: [
            { kind: "haptic", style: "success" },
            { kind: "copyToClipboard", text: "$state.item.output", toastMessage: "Copied." },
          ] }
        : { kind: "haptic", style: "selection" },
      // The × on a card, or a long-press: ask why first (the card is in the
      // row itself — a row's state is its own, so the question lives there).
      askDelete: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "setState", path: "askDelete", value: true },
      ] },
      keepEntry: { kind: "setState", path: "askDelete", value: false },
      // Either reason removes it. The reason goes with it, so "it doesn't
      // sound like me" can be counted apart from tidying up. Then the whole
      // screen reloads: the list's own refresh would write into the row.
      deleteNotMe: deleteFor("not_me"),
      deleteCleanup: deleteFor("cleanup"),
      err: { kind: "toast", message: "Couldn't reach history. Try again.", tone: "error" },
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
            // Entries are prose. Sixty characters is where a line stops being
            // easier to read and starts being further to travel.
            ...readable(ctx, 620),
          },
          children: [
            // The way back, in the ink of this screen rather than the theme's.
            {
              type: "Stack",
              on: { onPress: { kind: "sequence", actions: [
                { kind: "haptic", style: "selection" },
                { kind: "navigateBack" },
              ] } },
              props: { pressOpacity: 0.55, hitSlop: 11 },
              style: {
                width: 34, height: 34, borderRadius: 17, borderWidth: 1,
                borderColor: u.rule, alignItems: "center", justifyContent: "center",
                marginBottom: 18, marginLeft: -2,
              },
              children: [{
                type: "SVG",
                props: { viewBox: "0 0 24 24", d: "M15 5 L8.5 12 L15 19",
                         fill: "none", stroke: u.ink, strokeWidth: 2.2,
                         strokeLinecap: "round", strokeLinejoin: "round" },
                style: { width: 15, height: 15 },
              }],
            },
            // The page title in the onboarding's heading face (touches.ts),
            // the subtitle and every label below in the app's own tokens:
            // this screen drew its type at 9, 11.5, 13, 14 and 34 in the
            // system face, which is what made it read as a different app.
            { ...t("", "grotesk", 32, { color: u.ink, letterSpacing: -0.8 }), props: { content: "@history.title" } },
            // A tap only copies where the build can; elsewhere it says so.
            { ...caption("", { color: u.inkDim, marginTop: 8, marginBottom: 20 }),
              props: { content: ctx.can?.has("ActionText")
                ? "@history.subtitle"
                : "Every cleanup you've kept, newest first. × to remove." } },
            { type: "ProgressBar", visibleIf: { truthy: "loading" } },

            // THE EASE, at the top. Words spoken against words written across
            // the entries below — the gap between the two is the work Tailzu
            // did, and the only number on this screen the user did not make
            // themselves. No amber here (none inside History): the written
            // half is the full pale and leads it, the spoken half the faint
            // one (see historyBreakdown).
            {
              type: "Stack",
              visibleIf: { truthy: "entries" },
              style: {
                backgroundColor: u.card, borderRadius: u.cardRadius,
                paddingVertical: 16, paddingHorizontal: 16, marginBottom: 20,
              },
              children: [
                label("The ease", { color: u.onCardDim, marginBottom: 12 }),
                {
                  type: "DonutChart",
                  bind: { data: "historyBreakdown" },
                  props: {
                    donut: true, size: 132, thickness: 20, legend: "right",
                    centerLabel: "written",
                    legendColor: u.onCard,
                    legendValueColor: u.onCardDim,
                    centerColor: u.onCard,
                    centerLabelColor: u.onCardDim,
                    emptyColor: u.rule,
                  },
                },
              ],
            },
            // NO HISTORY YET: Blip, and one warm line. Shown only when the list
            // is empty and nothing is loading, so it never flashes in front of
            // entries that are on their way. The List's own empty label is
            // left blank below, so the two never say it twice.
            {
              type: "Stack",
              visibleIf: { all: [{ eq: ["entries.length", 0] }, { eq: ["loading", false] }] },
              style: { alignItems: "center", marginTop: 28, marginBottom: 12 },
              children: [
                blipPicture("listen-s", 0.9),
                { ...caption("", { color: u.inkDim, textAlign: "center", marginTop: 14, maxWidth: 280 }),
                  props: { content: sw("e.hist"), keepCase: true } },
              ],
            },
            {
              type: "List",
              bind: { items: "entries" },
              on: { onAppear: "refresh", onRefresh: "refresh" },
              props: {
                emptyLabel: "",
                itemTemplate: {
                  type: "Stack",
                  on: { onPress: "openDetail", onLongPress: "askDelete" },
                  props: { pressOpacity: 0.85 },
                  style: {
                    backgroundColor: u.card, borderRadius: u.cardRadius,
                    padding: 16, marginBottom: u.gap,
                  },
                  children: [
                    {
                      // Just when it happened. The app badge is gone: on iOS a
                      // keyboard extension cannot learn its host app, so it
                      // labelled every card "Generic" — a word that meant
                      // nothing and looked like a category to understand.
                      //
                      // The time is formatted on the DEVICE. The server knows
                      // the instant but not the timezone, and a list that says
                      // 08:30 to someone who dictated at 14:00 is worse than
                      // no time at all.
                      ...label("", { color: u.onCardFaint }),
                      bind: { content: "item.createdAt" },
                      props: { format: "relative" },
                    },
                    // What was heard, then what was written. Labelled and in
                    // that order: the whole point of the pair is the
                    // difference between them, and unlabelled the raw
                    // transcript reads as a mistake rather than as the input.
                    // Said in the hand, written in the book face: the app's own
                    // rule for the pair (phoneLook.ts), as the Voices cards draw it.
                    label("You said", { color: u.onCardFaint, marginTop: 14 }),
                    { ...t("", "said", 17, { color: u.onCardDim, marginTop: 6 }),
                      bind: { content: "item.input" }, props: { numberOfLines: 3 } },
                    // What the app wrote — marked by weight below, not by
                    // colour: no amber inside History.
                    label("X0 Bot wrote", { color: u.onCardFaint, marginTop: 14 }),
                    { ...t("", "written", 16, { color: u.onCard, marginTop: 6 }),
                      bind: { content: "item.output" }, props: { numberOfLines: 6 } },
                    cross,
                    askWhy,
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 45,
  };
}
