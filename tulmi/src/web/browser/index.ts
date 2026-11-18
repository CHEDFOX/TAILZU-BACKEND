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
import type { RenderOptions, VisitOptions, VisitedPage } from "./types.js";
import { findChrome } from "./chrome.js";
import { cloudflareRendererFromConfig } from "./cloudflare.js";

export { BrowserEngine, BrowserError, rendererFrom } from "./engine.js";
export type { RenderedPage, RenderOptions, Renderer } from "./engine.js";
export type { ShotOptions, Screenshotter } from "./types.js";
export type { SiteState, VisitOptions, VisitedPage } from "./types.js";
export { findChrome } from "./chrome.js";

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
 * THE VISITOR: opens a page AS SOMEBODY and hands the session back (src/sites, docs/sites.md). Null when this server has
 * no Chrome of its own.
 *
 * Only the local engine can do this. Cloudflare's Browser Rendering renders a page and gives back HTML; it cannot be
 * handed a person's cookies and asked for the ones that came back, which is the whole of what a signed-in visit is. So a
 * server on WEB_BROWSER=cloudflare has no cloud browser, and says so rather than quietly reading pages as a stranger —
 * which would answer "please sign in" for every watch and look like a bug.
 */
/**
 * THE HOLDER: a page kept open while a person looks at it (src/sites/panel.ts). Local Chrome only, for the same
 * reason the visitor is — a rendering service hands back HTML and cannot be tapped on.
 */
export function getHolder(): BrowserEngine["hold"] | null {
  const cfg = getConfig();
  if (cfg.WEB_BROWSER !== "local") return null;
  if (!getRenderer()) return null;
  const e = engine;
  return e ? (o: Parameters<BrowserEngine["hold"]>[0]) => e.hold(o) : null;
}

export function getVisitor(): ((o: VisitOptions) => Promise<VisitedPage>) | null {
  const cfg = getConfig();
  if (cfg.WEB_BROWSER !== "local") return null;
  // Share the one engine with the reader: same Chrome, same three places, same queue.
  if (!getRenderer()) return null;
  const e = engine;
  return e ? (o: VisitOptions) => e.visit(o) : null;
}

/**
 * The server's own browser as a MEASURER (code/agent/probe.ts): it draws a page at a given size, can tell it the person has asked for less motion,
 * and runs one expression in it. Only the real Chrome can do this — Cloudflare's content endpoint returns HTML and runs nothing of ours — so this
 * is null wherever WEB_BROWSER is not "local", and the round that wanted it simply keeps its pictures and the free floor.
 */
export function getMeasurer(): ((url: string, o: RenderOptions) => Promise<{ value?: unknown }>) | null {
  if (getConfig().WEB_BROWSER !== "local") return null;
  const render = getRenderer();
  return render ? (url, o) => render(url, o) : null;
}
