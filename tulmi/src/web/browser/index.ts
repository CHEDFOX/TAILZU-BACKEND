/**
 * THE BROWSER, AS THE REST OF THE SERVER GETS IT.
 *
 * getRenderer() is what the search tools and the agent loop pass to readPage as
 * `render`: a function that opens a page in a real browser and hands back its
 * HTML, or null when this server has no browser to offer (WEB_BROWSER is "off",
 * or "local" with no Chrome found, or "cloudflare" with no account and token), in which case readPage says needs_browser
 * for a page that only exists once its scripts have run.
 *
 * LATER, LAYER 8: render where the job runs. A page for the user's own errand
 * is better opened on the user's own machine (the desktop app has a browser,
 * and their IP address and their ordinary network), and a Xode job's page
 * can be opened on its GitHub Actions runner, which has Chrome preinstalled.
 * Both are another provider of the same `Renderer` (browser/engine.ts): the
 * folder is built so that engine.ts, guard.ts, cdp.ts and chrome.ts can be
 * bundled into the runner script or the app without the rest of the server.
 * They import nothing from the app but the list of blocked addresses
 * (connectors/egress.ts isBlockedAddress). This file is the only one in here
 * that reads config, and it is the only one that stays behind. Not built yet.
 */
import { getConfig } from "../../config.js";
import { BrowserEngine, rendererFrom, type Renderer } from "./engine.js";
import type { Screenshotter } from "./types.js";
import { findChrome } from "./chrome.js";
import { cloudflareRendererFromConfig } from "./cloudflare.js";

export { BrowserEngine, BrowserError, rendererFrom } from "./engine.js";
export type { RenderedPage, RenderOptions, Renderer } from "./engine.js";
export type { ShotOptions, Screenshotter } from "./types.js";
export { findChrome } from "./chrome.js";
export { cloudflareRenderer, cloudflareRendererFromConfig } from "./cloudflare.js";

let engine: BrowserEngine | null = null;
let warned = false;

/**
 * The server's own browser, or null. The same engine (one Chrome) serves every caller.
 * WEB_BROWSER=cloudflare is Cloudflare's Browser Rendering instead (cloudflare.ts): no Chrome here, one REST call per page.
 * (The jobs Worker imports cloudflare.ts directly: this file also holds the Chrome engine, which a Worker cannot run.)
 */
export function getRenderer(): Renderer | null {
  const cfg = getConfig();
  if (cfg.WEB_BROWSER === "cloudflare") return cloudflareRendererFromConfig();
  if (cfg.WEB_BROWSER !== "local") return null;
  if (!engine) {
    const chromePath = findChrome({ chromePath: cfg.CHROME_PATH });
    if (!chromePath) {
      if (!warned) {
        warned = true;
        console.warn("[web] WEB_BROWSER=local but no Chrome was found (set CHROME_PATH): pages that need scripts answer needs_browser.");
      }
      return null;
    }
    engine = new BrowserEngine({ chromePath, userAgent: cfg.WEB_BOT_UA });
  }
  return rendererFrom(engine);
}

/**
 * The server's own browser as a screenshotter (engine.ts `screenshot`): for WEB_BROWSER=local with a Chrome found, else null. (With
 * WEB_BROWSER=cloudflare shots go to Cloudflare's /screenshot endpoint: artifacts/shots.ts.)
 */
export function getScreenshotter(): Screenshotter | null {
  if (getRenderer() === null || getConfig().WEB_BROWSER !== "local") return null;
  return (o) => engine!.screenshot(o);
}

/** Shuts the server's browser down (it also does so by itself when idle). For shutdown and for tests. */
export async function closeBrowser(): Promise<void> {
  const e = engine;
  engine = null;
  warned = false;
  if (e) await e.close();
}
