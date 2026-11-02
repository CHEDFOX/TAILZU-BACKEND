/**
 * The free plan's words are used up.
 */

import { type ScreenResponse, SDUI_SCHEMA_VERSION, type Node } from "../../../../shared/types/sdui.js";
import { freeMonthlyWords } from "../policy.js";
import type { ScreenContext } from "../screens.js";
import { WORDS_GATE, wordsCopy } from "../wordsGate.js";
import { THEME } from "./theme.js";

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
export function wordsOutScreen(ctx: ScreenContext): ScreenResponse {
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
        // The theme's muted ink, not amber: running out is not something live.
        { type: "Text", props: { content: fill(w.kicker), variant: "overline" },
          style: { color: THEME.color.muted } },
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
