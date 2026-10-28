/**
 * THE BOTS APP (docs/bots-app.md): the new design of the phone and desktop apps, "everything is a bot".
 *
 * BOTS_APP (config.ts) on, and a build that declares "BotsKit": the bootstrap gives it the Bots app's tabs (Bots,
 * Activity, You) and lands it on bots.home; every "bots.*" screen id is answered here, for the phone or the window by
 * the client's own word (capabilities.device.formFactor). Off, or an older build: nothing here runs, and the app is
 * today's.
 *
 * The screens live in screens/*.ts, one file per area, each a list this module joins. Add a screen to the file of
 * its area; this file does not change.
 */
import type { NavigationShell, ScreenResponse, TabGlyph } from "../../../../shared/types/sdui.js";
import { BOTS_KIT_CAPABILITY } from "../../../../shared/types/sdui.js";
import { comingSoon, type BotsCtx, type Client } from "./kit.js";
import { loadLive, type BotsDeps } from "./live.js";
import { isBotsScreen, type BotsScreen } from "./registry.js";
import { botsScreens } from "./screens/bots.js";
import { codeScreens } from "./screens/code.js";
import { keybotScreens } from "./screens/keybot.js";
import { shellScreens } from "./screens/shell.js";
import { youScreens } from "./screens/you.js";

export { isBotsScreen, screen, type BotsScreen } from "./registry.js";
export { botsDepsFor, emptyDeps, type BotsServices } from "./deps.js";
export { botsFonts } from "./kit.js";

const ALL: BotsScreen[] = [...shellScreens, ...youScreens, ...botsScreens, ...keybotScreens, ...codeScreens];

/** Every registered screen, by id. Two files claiming one id is a mistake caught when the server starts. */
export const BOTS_SCREENS: ReadonlyMap<string, BotsScreen> = (() => {
  const m = new Map<string, BotsScreen>();
  for (const s of ALL) {
    if (!isBotsScreen(s.id)) throw new Error(`bots app: "${s.id}" is not a bots.* id`);
    if (m.has(s.id)) throw new Error(`bots app: two screens claim "${s.id}"`);
    m.set(s.id, s);
  }
  return m;
})();

/** Is the Bots app on for this request? The switch, a build that draws the kit, and (while set) the testers list. */
export function botsAppOn(o: { on: boolean; testers?: string; email?: string | null; components?: unknown }): boolean {
  if (!o.on) return false;
  const can = o.components instanceof Set ? o.components.has(BOTS_KIT_CAPABILITY)
    : Array.isArray(o.components) && o.components.includes(BOTS_KIT_CAPABILITY);
  if (!can) return false;
  const testers = (o.testers ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !testers.length || (!!o.email && testers.includes(o.email.trim().toLowerCase()));
}

/** A circle as a path (the tab glyphs below are paths). */
const ring = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/**
 * The tabs' still glyphs, for the native tab bar. A Bots page draws its own living tab bar (kit.tabBar) and hides
 * the app's; these show only under one of today's screens opened from the Bots app (keyboard settings, notes).
 */
const STILL: Record<string, TabGlyph> = {
  bots: { viewBox: "0 0 24 24", layers: [[7.5, 7.5], [16.5, 7.5], [7.5, 16.5], [16.5, 16.5]].map(([x, y]) => ({ d: ring(x!, y!, 3.2), stroke: 1.6, activeFill: true })) },
  activity: { viewBox: "0 0 24 24", layers: [
    { d: "M6 4v16", stroke: 1.6 }, { d: ring(6, 5, 2.4), stroke: 1.6, activeFill: true }, { d: ring(6, 12, 2.4), stroke: 1.6 },
    { d: ring(6, 19, 2.4), stroke: 1.6 }, { d: "M11.5 5h9M11.5 12h6.5M11.5 19h8", stroke: 1.8 },
  ] },
  you: { viewBox: "0 0 24 24", layers: [{ d: ring(12, 12, 9), stroke: 2.2 }, { d: ring(12, 12, 3.4), fill: true, activeFill: true }] },
};

/** The Bots app's tabs. One tab id per living icon; the screens are bots.home, bots.activity, bots.you. */
export function botsNav(): NavigationShell {
  return {
    kind: "tabs",
    tabs: [
      { id: "bots", title: "Bots", screenId: "bots.home", glyph: STILL.bots },
      { id: "activity", title: "Activity", screenId: "bots.activity", glyph: STILL.activity },
      { id: "you", title: "You", screenId: "bots.you", glyph: STILL.you },
    ],
    rail: false,
    initialTabId: "bots",
  };
}

/** Fetched at launch, before they are asked for: the three tab roots. */
export const BOTS_WARM_SCREEN_IDS = ["bots.home", "bots.activity", "bots.you"];

/** What a request says about itself (server.ts fills it in). */
export interface BotsRequest {
  screenId: string;
  client: Client;
  params?: Record<string, string | number | boolean | undefined>;
  user: BotsCtx["user"];
  can: ReadonlySet<string>;
  desk: BotsCtx["desk"];
  tzOffsetMinutes?: number;
}

/**
 * A Bots app screen: the live reads, the screen's own `load`, its builder. An id nobody has built yet answers the
 * "on its way" page, so a link to it is never a dead end. A failed read draws the screen without it.
 */
export async function buildBotsScreen(req: BotsRequest, deps: BotsDeps): Promise<ScreenResponse> {
  const tz = req.tzOffsetMinutes ?? 0;
  const live = await loadLive(deps, tz);
  const ctx: BotsCtx = {
    screenId: req.screenId, client: req.client, params: req.params ?? {}, live, user: req.user, can: req.can,
    desk: req.desk, tzOffsetMinutes: tz,
  };
  const def = BOTS_SCREENS.get(req.screenId);
  if (!def) return comingSoon(ctx);
  const data = def.load ? await def.load(ctx, deps).catch(() => undefined) : undefined;
  return def.build(ctx, data);
}
