/**
 * The Bots app shell's askAnswer screen.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import { upiOf } from "../../../../shell/parse.js";
import { type BotsCtx, row, box, body, button, C, col, icon, meta, statusMark, text, grow, open, SCREENS, toTab, page, askBar } from "../../kit.js";
import type { Card } from "../../../../everyday/index.js";
import { findsCards } from "../finds.js";
import { isRoutineToken, routineCard, routineCardState } from "../routines.js";
import { nameOf, avatarOf, colorOf } from "./parts.js";

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
  // The Oracle answered: its own page is a tap away (its cards ask for the birth details it reads nothing without).
  if (slug === "oracle") blocks.push(row([button("Open the Oracle", open(SCREENS.chat, { slug: "oracle" }), { kind: "secondary", size: "md" })]));
  // What the everyday tools found: flights, hotels, money, weather, as cards that link out (screens/finds.ts).
  blocks.push(...findsCards(ctx, cards));
  if (job) {
    blocks.push(row([statusMark("working", { color: colorOf(ctx, "code") }), text("Xode is on it", { size: 14, lineHeight: 19 }), grow(), text("Watch", { size: 14, weight: 500, lineHeight: 19 }), icon("chevron", { size: 16 })], {
      gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line,
    }, open(SCREENS.codeJob, { id: job })));
  }
  if (upi) {
    blocks.push(row([
      icon("rupee", { size: 20 }),
      col([text(`Pay ${upi.name}?`, { size: 15, weight: 600, lineHeight: 20 }), meta("You type the amount and press pay in your UPI app")], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      icon("chevron", { size: 16, color: C.meta }),
    ], { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line }, open(SCREENS.approve, { upi: upi.link, bot: slug || "tailzu" })));
  }
  if (needs > 0) {
    blocks.push(row([statusMark("needs"), text(needs === 1 ? "1 change waits for your yes" : `${needs} changes wait for your yes`, { size: 14, lineHeight: 19 }), grow(), icon("chevron", { size: 16, color: C.meta })], {
      gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line,
    }, toTab("activity")));
  }
  return page(ctx, { back: true, backTitle: "Ask", title: "Ask", nav: "bots", body: blocks, footer: [askBar(ctx.client, { ctx })], gap: 18 });
}
