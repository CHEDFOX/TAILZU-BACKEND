/**
 * WHAT A RENDERER IS, WHOEVER RUNS IT.
 *
 * A Renderer opens a page whose words only exist once its scripts have run and
 * hands back the HTML. engine.ts is the VPS's own Chrome; cloudflare.ts is
 * Cloudflare's Browser Rendering. They share these types, and nothing else, so
 * the Worker that renders on Cloudflare does not bundle the Chrome engine (child
 * processes, sockets, a proxy). engine.ts re-exports them.
 */

export interface RenderOptions {
  /** The whole render, queue excluded. Default 20 s. */
  timeoutMs?: number;
  /** Fail images, media and fonts. Default true. */
  blockResources?: boolean;
}

export interface RenderedPage {
  /** The page's HTML after its scripts ran and the invisible was removed. */
  html: string;
  /** Where the page ended up (redirects and scripts included). */
  finalUrl: string;
  title: string;
  /** The status of the page's own document (200 when the browser did not say). */
  status: number;
}

/** What readPage takes to render a page that needs its scripts. */
export type Renderer = (url: string, opts?: RenderOptions) => Promise<RenderedPage>;

export type BrowserErrorCode = "bad_url" | "blocked" | "timeout" | "navigation_failed" | "crashed" | "unavailable" | "busy";

export class BrowserError extends Error {
  constructor(readonly code: BrowserErrorCode, message?: string) {
    super(message ?? code);
    this.name = "BrowserError";
  }
}

/** What a screenshot is of, and how (engine.ts `screenshot`; shots.ts asks Cloudflare's /screenshot the same things). */
export interface ShotOptions {
  /** An address to open, or `html` to show: not both. */
  url?: string;
  html?: string;
  viewport: { width: number; height: number; mobile?: boolean };
  /** Cookies to hold while the page loads. `url` or `domain` says where they go; `url` defaults to the page's address. */
  cookies?: Array<{ name: string; value: string; url?: string; domain?: string; path?: string }>;
  /** Wait until an element matches this selector (after the page has loaded), at most `selectorTimeoutMs`. */
  waitForSelector?: string;
  selectorTimeoutMs?: number;
  /** A request whose address matches none of these is refused. Absent: every request the guard lets through. */
  allow?: RegExp[];
  /** The whole shot, queue excluded. Default 30 s. */
  timeoutMs?: number;
}

/** What shots.ts takes to make a picture of a page without Cloudflare: PNG bytes. */
export type Screenshotter = (o: ShotOptions) => Promise<Uint8Array>;

/* ------------------------------------------------------------------ a page visited AS SOMEBODY (src/sites, docs/sites.md) */

/**
 * The cookies and storage that make a browser "already signed in" at one site. Carried IN so the page opens as
 * them, and carried back OUT because a site refreshes its own session as you use it — write the new one back or
 * the slip goes stale and they are signed out in a week.
 *
 * The browser itself keeps nothing between visits: a fresh context every time, filled from this and emptied into
 * it. So there is no live session to leak, nothing to shut down on a timer, and a crash loses a visit, not a login.
 */
export interface SiteState {
  cookies: unknown[];
  /** localStorage and sessionStorage, as [origin, key, value]. Half of a modern session lives here, not in cookies. */
  storage?: Array<[string, string, string]>;
}

/** One control or line of words on the page, as the planner reads them (shared AgentElement's shape, by hand here
 *  so this file stays free of the app). */
export interface VisitElement {
  id: string;
  /** button link field secret area check radio combo tab menuitem. `secret` is a password box and never carries a value. */
  role: string;
  label?: string;
  /** Never a password's, and never a tickbox's "on": `checked` says that. */
  value?: string;
  checked?: boolean;
}

export interface VisitOptions {
  url: string;
  /** Who to be. Absent: a stranger. */
  state?: SiteState;
  viewport?: { width: number; height: number; mobile?: boolean };
  /** A request whose address matches none of these is refused. */
  allow?: RegExp[];
  timeoutMs?: number;
}

export interface VisitedPage {
  finalUrl: string;
  title: string;
  /** The words a person could see, invisible nodes removed, ≤ 20000. */
  text: string;
  /** What is on it, in reading order, ≤ 250. */
  elements: VisitElement[];
  /** The session as it stands AFTER the visit: save this, not the one you sent. */
  state: SiteState;
}
