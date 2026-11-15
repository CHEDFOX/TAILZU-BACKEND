/**
 * THE MAKING, IN THE FRAME (docs/cinema.md, "The making in the talk"): while a film or a picture is being made the card does not
 * show a bar filling up. It shows the frame the thing is being made in - the very shape that was asked for, 9:16 or 16:9 or
 * anything else - and the bot at work inside it, doing the job the film is actually at:
 *
 *   writing, script      c.script   he writes, reads it back, screws it up, walks out to think, comes back with the one that works
 *   boarding, board      c.board    he draws the storyboard, leans back to see whether it reads, goes in again
 *   rendering            c.shoot    the crew come in from the right with the camera and the light, he claps the board, it rolls
 *   cutting              c.cut      the bench, the takes going past him, the frames he keeps
 *   a picture            c.sketch   he draws it at the board, leans back, and carries the board off when it is done
 *
 * They are all the same bot, smaller when there are more of them (shared/bots/looks.json: crew_cam, crew_lamp are cinema blips
 * at 0.62 of his height). Each recipe loops for as long as the work takes, so a long film is not a longer animation - it is the
 * same room, still busy.
 *
 * IT IS ONE PERFORMANCE. The person never sees a new scene start: each recipe strikes the set before it and wheels in its own,
 * and `loopFrom` keeps that changeover out of the loop. The server drives it and nothing else - a status move publishes on the
 * bot's live topic, the session screen is subscribed, and the next draw carries the next recipe. `life` is the film's own id, so
 * it is the same bot throughout: he carries on from where he is rather than starting again every time the page is drawn.
 * `c.shoot` and `c.sketch` also have an `end`: the crew pack up and walk off, which a screen plays with `momentEndWhen`.
 *
 * A build that draws no bot (no BotBuddy) gets the frame alone, in the film's shape, which is still the truth of it.
 */
import type { Node } from "../../../../../../shared/types/sdui.js";
import { RATIO, type Aspect, type FilmStatus } from "../../../../cinema/types.js";
import { type BotsCtx, botBuddy, botMoment, box, C, canBuddy } from "../../kit.js";
import { DIRECTOR } from "./cinemaPage.js";

/** What he is doing, from where the film stands. A film waiting on the person is a film he is still fussing over. */
export function momentFor(f: { status: FilmStatus; hold?: string | null }): string {
  if (f.hold) return "c.frame";
  switch (f.status) {
    case "writing": case "script": return "c.script";
    case "boarding": case "board": return "c.board";
    case "rendering": return "c.shoot";
    case "cutting": return "c.cut";
    default: return "c.frame";
  }
}

/**
 * The frame's own size: the shape that was asked for, as wide as the row allows, and never so tall that it pushes the talk
 * off the screen. A tall film is narrow rather than enormous.
 */
export function frameBox(aspect: Aspect, row: number, cap: number): { w: number; h: number } {
  const r = Math.max(RATIO[aspect] ?? 1, 0.3);
  const h = Math.min(Math.round(row / r), cap);
  return { w: Math.max(72, Math.min(row, Math.round(h * r))), h };
}

/**
 * The stage itself: the frame, and him working in it. `size` keeps the room about three and a half of him wide whatever the
 * shape, which is what the recipes are drawn for: the crew come to rest at a share of the room's width (`W`), so they land in
 * the same place in a tall frame as in a wide one.
 */
export function makingFrame(ctx: BotsCtx, o: { color: string; life: string; moment: string; w: number; h: number }): Node {
  const size = Math.max(24, Math.min(110, Math.round(Math.min(o.h * 0.52, o.w / 3.6))));
  const him = canBuddy(ctx)
    ? [botBuddy({
      kind: "custom", color: o.color, life: o.life, width: o.w, height: o.h, size,
      state: "working", avatar: DIRECTOR, ...botMoment(ctx, o.moment, "loop"),
    })]
    : [];
  return box(him, { width: o.w, height: o.h, borderRadius: 14, backgroundColor: C.surface, overflow: "hidden", flexShrink: 0 });
}
