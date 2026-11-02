/**
 * The Code bot at work's done screen.
 */

import { isOver } from "../../../../botsCodeWork/read.js";
import type { BotsCtx } from "../../kit.js";
import { failedScreen } from "./failed.js";
import { jobScreen } from "./job.js";
import { type DoneData, nothingHere, doneDesk, donePhone } from "./parts.js";

export function doneScreen(ctx: BotsCtx, d: DoneData | undefined) {
  if (!d) return nothingHere(ctx, "Job");
  if (d.job.job.state !== "done") {
    return isOver(d.job.job.state) ? failedScreen(ctx, d.job) : jobScreen(ctx, { job: d.job });
  }
  return ctx.client === "desktop" ? doneDesk(ctx, d) : donePhone(ctx, d);
}
