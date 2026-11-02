/**
 * The card the app shows at launch: the words milestone and its look.
 */

import type { LaunchCard, Node } from "../../../../shared/types/sdui.js";
import type { Allowance } from "../../usage/allowance.js";
import { THEME } from "../phone/theme.js";
import { freeForAll, freeMonthlyWords } from "../policy.js";
import { WORDS_GATE, wordsCopy } from "../wordsGate.js";

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
export function wordsMilestoneCard(opts: {
  entitled?: boolean;
  isReviewer?: boolean;
  wordsUsed?: number;
  allowance?: Allowance | null;
  /** Where its button goes: the Bots app's own Plans, or today's paywall. */
  plansScreenId?: string;
}): LaunchCard | null {
  if (opts.entitled === true || opts.isReviewer || freeForAll()) return null;
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
    screenId: opts.plansScreenId ?? WORDS_GATE.paywallScreenId,
    dismiss: WORDS_GATE.dismiss,
  });
}

export const LAUNCH_CARD: LaunchCard | null = null;

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
