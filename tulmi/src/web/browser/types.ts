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
