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
