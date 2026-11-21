/**
 * WHAT AN ANSWER LEFT TO DO, AS CARDS: a Xode job to watch, a payment to press, changes waiting for a yes.
 *
 * These were the Ask screen's own (askAnswer.ts), drawn once there. Talk's thread draws the same three under the answer's
 * words (docs/talk-door.md), so they live here and both screens draw the ONE implementation: a card that changed in one
 * place and not the other would be the same thing with two faces, which is the thing this app is most careful about.
 *
 * NOTHING NEW IS INVENTED HERE. Every other thing an answer carries already had somewhere to be drawn, and keeps it:
 * what the bot itself chose to draw under its words (src/show, docs/show.md) goes through `showNodes`; what the everyday
 * tools found goes through `findsCards` (screens/finds.ts); a routine to save through `routineCard` (screens/routines.ts).
 * This file is only the three cards that had no home but the Ask page.
 *
 * Each is SMALL on purpose: one row, a line of words, a chevron. The work itself has a page of its own and the card is
 * the way to it — a job's whole progress, a trip, a day's plan belong on their pages, not in a message.
 */
import type { Node } from "../../../../../../shared/types/sdui.js";
import { upiOf } from "../../../../shell/parse.js";
import { type BotsCtx, row, col, text, meta, icon, grow, statusMark, open, SCREENS, toTab, C } from "../../kit.js";
import { colorOf } from "./parts.js";

/** The one shape all three wear: a row that opens something, inside a hairline box. */
const doorRow = (children: Node[], onPress: Node extends never ? never : Parameters<typeof row>[2]): Node =>
  row(children, { gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line }, onPress);

/** "Xode is on it · Watch": a job started by what was said. Its stages, its plan and its questions are on its own page. */
export function jobCard(ctx: BotsCtx, job: string): Node {
  return doorRow([
    statusMark("working", { color: colorOf(ctx, "code") }),
    text("Xode is on it", { size: 14, lineHeight: 19 }),
    grow(),
    text("Watch", { size: 14, weight: 500, lineHeight: 19 }),
    icon("chevron", { size: 16 }),
  ], open(SCREENS.codeJob, { id: job }));
}

/**
 * "Pay Mom?": the payment the answer filled in. The amount and the pressing happen in the person's own UPI app, never
 * here — the card only opens the approval screen, which is where that promise is kept (docs/bots-app.md section 12).
 */
export function payCard(upi: string, slug: string): Node | null {
  const u = upiOf(upi);
  if (!u) return null;
  return doorRow([
    icon("rupee", { size: 20 }),
    col([
      text(`Pay ${u.name}?`, { size: 15, weight: 600, lineHeight: 20 }),
      meta("You type the amount and press pay in your UPI app"),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    icon("chevron", { size: 16, color: C.meta }),
  ], open(SCREENS.approve, { upi: u.link, bot: slug || "tailzu" }));
}

/** "2 changes wait for your yes": what the answer set going that the person has to allow. Activity holds them. */
export function waitsCard(needs: number): Node | null {
  if (!(needs > 0)) return null;
  return doorRow([
    statusMark("needs"),
    text(needs === 1 ? "1 change waits for your yes" : `${needs} changes wait for your yes`, { size: 14, lineHeight: 19 }),
    grow(),
    icon("chevron", { size: 16, color: C.meta }),
  ], toTab("activity"));
}

/** What an answer left to do, as the turn kept it (botsBots/chat.ts TurnDid). */
export interface Did { job?: string; upi?: string; needs?: number }

/** The three cards for one answer, in the order they matter: the money first, then the work, then what waits. */
export function didCards(ctx: BotsCtx, did: Did | undefined, slug: string): Node[] {
  if (!did) return [];
  const out: Node[] = [];
  const pay = did.upi ? payCard(did.upi, slug) : null;
  if (pay) out.push(pay);
  if (did.job) out.push(jobCard(ctx, did.job));
  const waits = waitsCard(did.needs ?? 0);
  if (waits) out.push(waits);
  return out;
}
