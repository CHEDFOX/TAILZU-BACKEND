/**
 * THE BROWSER ON CLOUDFLARE: A PAGE'S SCRIPTS RUN THERE, AND WHAT IT SHOWS COMES BACK AS HTML.
 *
 * A Cloudflare Worker has no Chrome to start (engine.ts starts one and talks to
 * it over a pipe), but Cloudflare runs headless browsers as a service. Browser
 * Rendering ("Browser Run" in the docs now) has a REST endpoint that opens a URL,
 * lets its scripts run, and returns the HTML:
 *
 *   POST https://api.cloudflare.com/client/v4/accounts/<account>/browser-run/content
 *   Authorization: Bearer <an API token with "Browser Rendering - Edit">
 *   { "url": "...", "gotoOptions": { "waitUntil": "networkidle2", "timeout": ms }, "rejectResourceTypes": [...], "bestAttempt": true }
 *   -> { "success": true, "result": "<html>", "meta": { "finalUrl", "status", "title" } }
 *
 * (docs: developers.cloudflare.com/browser-run/quick-actions/content-endpoint/.
 * The API reference still lists the same route as /browser-rendering/content; the
 * product page's name is tried first and that one on a 404.)
 *
 * This is a Renderer (types.ts) like the VPS's engine, so readPage uses it the
 * same way: `render` is passed when a page needs its scripts, and the reader's
 * own extractor and its safety rules then run on the HTML it gets back. What this
 * file adds are the checks the engine makes before it opens a page, and one the
 * engine makes with its proxy: THE ADDRESS IS JUDGED BEFORE IT IS SENT (http or
 * https only, nothing written as an IP, no name that can only be private), and
 * where the page ENDED UP (meta.finalUrl, redirects and scripts included) is
 * judged by the same rule afterwards. The browser itself runs on Cloudflare's
 * network, not in ours.
 *
 * No Node module is imported: it runs on the Worker and on the VPS alike (the
 * VPS may also use it, WEB_BROWSER=cloudflare). The fetch is injectable.
 */
import { getConfig } from "../../config.js";
import { isIpLiteral } from "../../connectors/egressTypes.js";
import { isPrivateName } from "../workerSafeFetch.js";
import { BrowserError, type RenderOptions, type RenderedPage, type Renderer } from "./types.js";

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
/** The product's name for the endpoint, and the name the API reference still lists. */
const PATHS = ["browser-run", "browser-rendering"] as const;
/** The default for one render, as engine.ts has it. */
const RENDER_TIMEOUT_MS = 20_000;
/** Cloudflare's own ceiling on gotoOptions.timeout. */
const GOTO_TIMEOUT_MAX_MS = 60_000;
/** The HTML kept, as engine.ts keeps. */
const HTML_MAX_CHARS = 4_000_000;
/** What the page is not asked for: most of its bytes and none of its words (engine.ts blockResources). */
const SKIPPED = ["image", "media", "font"] as const;

export interface CloudflareRendererOptions {
  accountId: string;
  /** An API token that may use Browser Rendering. */
  apiToken: string;
  /** Sent as the page's User-Agent. */
  userAgent?: string;
  /** In place of the platform's fetch. Tests. */
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  /** In place of https://api.cloudflare.com/client/v4. Tests. */
  baseUrl?: string;
}

/** Whether a page's address is one to open: http(s), a public name. */
function checkTarget(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new BrowserError("bad_url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BrowserError("bad_url");
  if (isIpLiteral(u.hostname) || isPrivateName(u.hostname)) throw new BrowserError("blocked");
  return u;
}

interface ContentReply {
  success?: boolean;
  result?: unknown;
  errors?: Array<{ code?: number; message?: string }>;
  meta?: { finalUrl?: unknown; status?: unknown; title?: unknown };
}

export function cloudflareRenderer(o: CloudflareRendererOptions): Renderer {
  const base = (o.baseUrl ?? CLOUDFLARE_API).replace(/\/+$/, "");
  const call = o.fetchFn ?? ((url, init) => fetch(url, init));

  return async function render(rawUrl: string, opts: RenderOptions = {}): Promise<RenderedPage> {
    const target = checkTarget(rawUrl);
    const timeoutMs = Math.max(1_000, opts.timeoutMs ?? RENDER_TIMEOUT_MS);
    const body = JSON.stringify({
      url: target.href,
      gotoOptions: { waitUntil: "networkidle2", timeout: Math.min(timeoutMs, GOTO_TIMEOUT_MAX_MS) },
      // A page that has started to show but never settles is read as it stands (engine.ts does the same).
      bestAttempt: true,
      ...(opts.blockResources === false ? {} : { rejectResourceTypes: SKIPPED }),
      ...(o.userAgent ? { userAgent: o.userAgent } : {}),
    });

    let res: Response | null = null;
    for (const path of PATHS) {
      try {
        res = await call(`${base}/accounts/${encodeURIComponent(o.accountId)}/${path}/content?cacheTTL=0`, {
          method: "POST",
          headers: { Authorization: `Bearer ${o.apiToken}`, "Content-Type": "application/json" },
          body,
          // The render has its own time inside; this one is for the call itself.
          signal: AbortSignal.timeout(timeoutMs + 10_000),
        });
      } catch (err) {
        const e = err as { name?: string } | null;
        if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new BrowserError("timeout");
        throw new BrowserError("unavailable", "Cloudflare could not be reached");
      }
      if (res.status !== 404) break;
      await res.body?.cancel().catch(() => {});
    }
    if (!res) throw new BrowserError("unavailable");

    if (res.status === 429) { await res.body?.cancel().catch(() => {}); throw new BrowserError("busy"); }
    if (res.status === 401 || res.status === 403) { await res.body?.cancel().catch(() => {}); throw new BrowserError("unavailable", "Cloudflare refused the API token"); }
    if (res.status === 408 || res.status === 504) { await res.body?.cancel().catch(() => {}); throw new BrowserError("timeout"); }
    if (res.status >= 500) { await res.body?.cancel().catch(() => {}); throw new BrowserError("unavailable", `Cloudflare answered ${res.status}`); }

    let json: ContentReply;
    try { json = (await res.json()) as ContentReply; } catch { throw new BrowserError("navigation_failed", "the answer could not be read"); }
    if (!res.ok || json.success !== true || typeof json.result !== "string") {
      const msg = json.errors?.map((e) => e.message ?? "").join(" ").toLowerCase() ?? "";
      throw new BrowserError(/timeout|timed out/.test(msg) ? "timeout" : "navigation_failed", "the page could not be rendered");
    }

    // Where the page ended up is judged like where it was asked for.
    let finalUrl = target.href;
    if (typeof json.meta?.finalUrl === "string" && json.meta.finalUrl) {
      const f = checkTarget(json.meta.finalUrl);
      finalUrl = f.href;
    }
    const status = typeof json.meta?.status === "number" && json.meta.status >= 100 && json.meta.status < 600 ? json.meta.status : 200;
    const title = typeof json.meta?.title === "string" ? json.meta.title : "";
    return { html: json.result.slice(0, HTML_MAX_CHARS), finalUrl, title, status };
  };
}

let warned = false;

/** The renderer for WEB_BROWSER=cloudflare, or null (with a line, once) when the account or the token is not set. */
export function cloudflareRendererFromConfig(): Renderer | null {
  const cfg = getConfig();
  if (!cfg.CLOUDFLARE_ACCOUNT_ID || !cfg.CLOUDFLARE_API_TOKEN) {
    if (!warned) {
      warned = true;
      console.warn("[web] WEB_BROWSER=cloudflare but CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not both set: pages that need scripts answer needs_browser.");
    }
    return null;
  }
  return cloudflareRenderer({ accountId: cfg.CLOUDFLARE_ACCOUNT_ID, apiToken: cfg.CLOUDFLARE_API_TOKEN, userAgent: cfg.WEB_BOT_UA });
}
