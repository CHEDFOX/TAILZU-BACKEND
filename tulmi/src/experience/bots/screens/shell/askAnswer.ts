/**
 * The Bots app shell's askAnswer screen.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import { upiOf } from "../../../../shell/parse.js";
import { type BotsCtx, row, box, body, button, C, col, icon, meta, open, SCREENS, page } from "../../kit.js";
import { askBar, ASK_BAR_STATE } from "../../ask.js";
import type { Card } from "../../../../everyday/index.js";
import { findsCards } from "../finds.js";
import { isRoutineToken, routineCard, routineCardState } from "../routines.js";
import { nameOf, avatarOf } from "./parts.js";
// The three cards an answer's leftovers draw, shared with Talk's thread (doorCards.ts).
import { jobCard, payCard, waitsCard } from "./doorCards.js";

/** The answer: what was asked, who answered and what came back; a payment it filled in; the bar to ask again. */
export function askAnswer(ctx: BotsCtx, cards?: Card[]) {
  const asked = String(ctx.params.message ?? "");
  const answer = String(ctx.params.answer ?? "");
  const slug = String(ctx.params.bot ?? "");
  const upi = upiOf(ctx.params.upi);
  const needs = Number(ctx.params.needs ?? 0) || 0;
  const job = typeof ctx.params.job === "string" && ctx.params.job ? ctx.params.job : "";
  const by = slug && slug !== "any" ? nameOf(ctx, slug) : "";
  const blocks: Node[] = [];
  if (asked) {
    blocks.push(row([box([body(asked)], { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14, maxWidth: "85%" })], { justifyContent: "flex-end" }));
  }
  // Words about a schedule: the routine to save, not an answer (screens/routines.ts).
  const routine = ctx.params.routine;
  if (isRoutineToken(routine)) {
    return page(ctx, {
      back: true, backTitle: "Ask", title: "Ask", nav: "bots", gap: 18, state: routineCardState(ctx, routine, slug),
      body: [...blocks, ...routineCard(ctx, routine, asked)],
    });
  }
  blocks.push(col([
    row([slug ? avatarOf(ctx, slug, 24) : icon("spark", { size: 16, color: C.meta }), meta(by ? `${by} answered` : "Answered by your bots", { size: 12 })], { gap: 6 }),
    ...(answer ? [body(answer, { lineHeight: 22 })] : []),
  ], { gap: 8 }));
  // Chamen answered: its own page is a tap away (its cards ask for the birth details it reads nothing without).
  if (slug === "oracle") blocks.push(row([button("Open Chamen", open(SCREENS.chat, { slug: "oracle" }), { kind: "secondary", size: "md" })]));
  // What the everyday tools found: flights, hotels, money, weather, as cards that link out (screens/finds.ts).
  blocks.push(...findsCards(ctx, cards));
  if (job) blocks.push(jobCard(ctx, job));
  if (upi) { const pay = payCard(upi.link, slug); if (pay) blocks.push(pay); }
  const waits = waitsCard(needs);
  if (waits) blocks.push(waits);
  return page(ctx, { back: true, backTitle: "Ask", title: "Ask", nav: "bots", body: blocks, footer: [askBar(ctx.client, { ctx })], gap: 18, state: ASK_BAR_STATE });
}
