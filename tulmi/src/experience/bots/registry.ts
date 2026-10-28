/**
 * HOW A BOTS APP SCREEN IS DEFINED: an id, what it reads, and one builder for both clients.
 *
 *   export const SCREENS_OF_YOURS = [
 *     screen({
 *       id: "bots.budget",
 *       load: (ctx, deps) => deps.api<{ jobs: unknown[] }>("GET", "/v1/code/jobs"),   // optional
 *       build: (ctx, data) => page(ctx, { tab: "you", body: [...] }),                  // pure: ctx + data in, a screen out
 *     }),
 *   ];
 *
 * `build` gets ctx.client ("phone" | "desktop") and branches only where the layouts differ; kit.page() picks the
 * phone frame (tab bar) or the window's (sidebar) by itself. `load` runs on the server per request, through
 * BotsDeps (live.ts): the live reads every screen gets, and `api` for anything else (the app's own HTTP routes,
 * as the signed-in person). A test hands `build` a ctx and data directly (fixtures.ts), so builders stay pure.
 */
import type { ScreenResponse } from "../../../../shared/types/sdui.js";
import type { BotsCtx } from "./kit.js";
import type { BotsDeps } from "./live.js";

export interface BotsScreen<D = unknown> {
  /** "bots.<name>": one id serves the phone and the window. */
  id: string;
  /** What the screen reads besides ctx.live. Its failure draws the screen with `undefined` data, never an error page. */
  load?: (ctx: BotsCtx, deps: BotsDeps) => Promise<D>;
  /** The screen, for ctx.client. Pure. */
  build: (ctx: BotsCtx, data: D | undefined) => ScreenResponse;
}

/** Declares a screen (keeps `D` checked between `load` and `build`). */
export function screen<D = undefined>(def: BotsScreen<D>): BotsScreen<unknown> {
  return def as BotsScreen<unknown>;
}

/** The ids the Bots app answers: every id starting with "bots.". */
export const isBotsScreen = (id: string): boolean => /^bots\.[a-z0-9_.-]{1,60}$/.test(id);
