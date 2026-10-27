/**
 * THE BROWSER ENGINE: A PAGE'S SCRIPTS RUN, AND WHAT IT SHOWS COMES BACK AS HTML.
 *
 * One headless Chrome, driven over the DevTools protocol (cdp.ts), started when
 * the first page needs it, shut down after 60 seconds with nothing to do, and
 * started again if it dies. Everything it fetches goes through the guard proxy
 * (guard.ts), so a page cannot reach anything the reader itself could not.
 *
 * render(url):
 *   - refuses anything but http(s), and a literal private address up front;
 *   - takes one of three places (a fourth page waits; a long queue says "busy");
 *   - makes a fresh incognito browser context for the page, with downloads
 *     denied, so no page sees another's cookies, storage or cache, and throws
 *     the whole context away afterwards;
 *   - with blockResources (the default), fails images, media and fonts at the
 *     request, which are most of a page's bytes and none of its words;
 *   - navigates, waits for the load event, then for 500 ms in which nothing is
 *     in flight (WebSockets, event streams and beacons are not counted: they may
 *     never end), all of it inside the time limit. A page that has started to
 *     show but never settles is read as it stands; one that never started is
 *     "timeout";
 *   - then runs a small script in the page that removes everything a person
 *     could not see, judged on COMPUTED style (display:none, visibility:hidden,
 *     opacity:0, zero size with overflow hidden), where the reader's own
 *     extractor can only read inline styles, and returns the page's HTML.
 *
 * Failures are BrowserError with a code: bad_url, blocked (the guard refused
 * the page), timeout, navigation_failed, crashed (Chrome died; tried once
 * more), unavailable (Chrome would not start), busy.
 *
 * Free of the app except what guard.ts uses, so it can be bundled elsewhere.
 */
import net from "node:net";
import { isBlockedAddress } from "../../connectors/egress.js";
import { CdpClient, CdpError, type CdpSession } from "./cdp.js";
import { launch, type LaunchedChrome } from "./chrome.js";
import { startGuard, type Guard, type GuardOptions } from "./guard.js";
import { BrowserError, type BrowserErrorCode, type RenderOptions, type RenderedPage, type Renderer, type ShotOptions } from "./types.js";

export { BrowserError };
export type { BrowserErrorCode, RenderOptions, RenderedPage, Renderer, ShotOptions };

export interface EngineOptions {
  chromePath: string;
  /** Sent as the User-Agent instead of "HeadlessChrome". */
  userAgent?: string;
  /** Idle time before Chrome is shut down. Default 60 s. */
  idleMs?: number;
  /** Pages at once. Default 3. */
  maxConcurrent?: number;
  /** Pages waiting for a place before "busy". Default 50. */
  maxQueued?: number;
  /** The guard's test seam (guard.ts); throws outside a test run. */
  guard?: Pick<GuardOptions, "allow" | "resolve">;
}

export const RENDER_TIMEOUT_MS = 20_000;
const QUIET_MS = 500;
const POLL_MS = 40;
/** Request types that may never finish, so "nothing in flight" cannot wait for them. */
const OPEN_ENDED = new Set(["EventSource", "WebSocket", "Ping", "CSPViolationReport", "Prefetch"]);

/**
 * Runs in the page. Removes what the page does not show: elements whose computed
 * style says they are hidden or have no size and clip their content (visibility
 * only takes away the element's own text, since a child may switch it back on),
 * then scripts and styles (nothing to read in them; the page's own data is kept),
 * and returns the document.
 */
const SNAPSHOT = `(() => {
  const out = { html: "", title: document.title || "", href: location.href };
  try {
    const clips = (v) => v === "hidden" || v === "clip";
    const gone = [];
    for (const el of document.querySelectorAll("body *")) {
      let cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.display === "none" || cs.opacity === "0") { gone.push(el); continue; }
      if (cs.visibility === "hidden" || cs.visibility === "collapse") {
        for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) n.remove();
        continue;
      }
      if (clips(cs.overflowX) || clips(cs.overflowY)) {
        const r = el.getBoundingClientRect();
        if ((r.width === 0 || r.height === 0) && el.textContent && el.textContent.trim()) gone.push(el);
      }
    }
    for (const el of gone) el.remove();
    for (const el of document.querySelectorAll("script, style, link[rel=stylesheet]")) {
      if (el.matches('script[type="application/ld+json"], script#__NEXT_DATA__')) continue;
      el.remove();
    }
  } catch (e) { /* what could be removed is removed */ }
  out.html = document.documentElement.outerHTML.slice(0, 4000000);
  return out;
})()`;

interface Running {
  guard: Guard;
  chrome: LaunchedChrome;
  cdp: CdpClient;
  alive: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BrowserEngine {
  private running: Running | null = null;
  private starting: Promise<Running> | null = null;
  private stopping: Promise<void> | null = null;
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Who the guard turned away lately, so a failed navigation can be told from an unreachable site. */
  private refusals: Array<{ host: string; at: number }> = [];

  constructor(private readonly o: EngineOptions) {}

  /** For diagnostics and tests. */
  state(): { running: boolean; active: number; queued: number; guard: { allowed: number; refused: number } | null } {
    return { running: !!this.running?.alive, active: this.active, queued: this.queue.length, guard: this.running ? { ...this.running.guard.stats } : null };
  }

  /** Stops Chrome and the guard now. The engine starts them again if it is asked for another page. */
  async close(): Promise<void> {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    await this.stop();
  }

  async render(rawUrl: string, opts: RenderOptions = {}): Promise<RenderedPage> {
    let u: URL;
    try { u = new URL(rawUrl); } catch { throw new BrowserError("bad_url"); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new BrowserError("bad_url");
    const bare = u.hostname.replace(/^\[|\]$/g, "");
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (net.isIP(bare) && isBlockedAddress(bare) && !this.o.guard?.allow?.(bare.toLowerCase(), port)) throw new BrowserError("blocked");

    await this.take();
    try {
      try {
        return await this.renderOnce(u, opts);
      } catch (err) {
        // Chrome died under the page: once more, on a fresh one.
        if (err instanceof BrowserError && err.code === "crashed") return await this.renderOnce(u, opts);
        throw err;
      }
    } finally {
      this.release();
    }
  }

  // ------------------------------------------------------------- a screenshot

  /**
   * A picture of a page, as PNG bytes: a fresh incognito context like render()'s, the viewport set (a phone's has `mobile`), cookies held, the page opened
   * (an address, or `html` shown in a blank page), the load event and half a second with nothing on the wire waited for, then `waitForSelector` if
   * there is one, then Page.captureScreenshot of what the viewport shows. With `allow`, every request whose address matches none of the patterns is refused
   * before it leaves (the guard still judges what is let through). The errors are render()'s.
   */
  async screenshot(o: ShotOptions): Promise<Uint8Array> {
    if ((o.url === undefined) === (o.html === undefined)) throw new BrowserError("bad_url", "a screenshot is of an address or of html, not both");
    let u: URL | null = null;
    if (o.url !== undefined) {
      try { u = new URL(o.url); } catch { throw new BrowserError("bad_url"); }
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new BrowserError("bad_url");
      const bare = u.hostname.replace(/^\[|\]$/g, "");
      const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
      if (net.isIP(bare) && isBlockedAddress(bare) && !this.o.guard?.allow?.(bare.toLowerCase(), port)) throw new BrowserError("blocked");
    }
    await this.take();
    try {
      try {
        return await this.shootOnce(u, o);
      } catch (err) {
        if (err instanceof BrowserError && err.code === "crashed") return await this.shootOnce(u, o);
        throw err;
      }
    } finally {
      this.release();
    }
  }

  private async shootOnce(u: URL | null, o: ShotOptions): Promise<Uint8Array> {
    const timeoutMs = o.timeoutMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;
    const left = () => Math.max(1_000, deadline - Date.now());
    const run = await this.ensure();
    const { cdp } = run;
    let contextId: string | undefined;
    const stops: Array<() => void> = [];
    try {
      contextId = (await cdp.send<{ browserContextId: string }>("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
      await cdp.send("Browser.setDownloadBehavior", { behavior: "deny", browserContextId: contextId });
      const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank", browserContextId: contextId });
      const page: CdpSession = await cdp.attach(targetId);

      const inflight = new Set<string>();
      let lastActivity = Date.now();
      let loaded = false;
      let mainFrame = "";
      stops.push(page.on("Network.requestWillBeSent", (p) => { if (!OPEN_ENDED.has(p.type)) inflight.add(p.requestId); lastActivity = Date.now(); }));
      for (const done of ["Network.loadingFinished", "Network.loadingFailed"]) stops.push(page.on(done, (p) => { inflight.delete(p.requestId); lastActivity = Date.now(); }));
      stops.push(page.on("Page.lifecycleEvent", (p) => { if (p.name === "load" && p.frameId === mainFrame) loaded = true; }));
      stops.push(page.on("Page.javascriptDialogOpening", () => { page.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {}); }));
      if (o.allow) {
        const allow = o.allow;
        stops.push(page.on("Fetch.requestPaused", (p) => {
          const url = String(p.request?.url ?? "");
          if (allow.some((re) => re.test(url))) page.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
          else page.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {});
        }));
      }

      await page.send("Page.enable");
      await page.send("Network.enable");
      await page.send("Page.setLifecycleEventsEnabled", { enabled: true });
      await page.send("Emulation.setDeviceMetricsOverride", { width: o.viewport.width, height: o.viewport.height, deviceScaleFactor: 1, mobile: o.viewport.mobile === true });
      if (this.o.userAgent) await page.send("Network.setUserAgentOverride", { userAgent: this.o.userAgent });
      if (o.allow) await page.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      if (o.cookies?.length) {
        await page.send("Network.setCookies", { cookies: o.cookies.map((c) => ({ name: c.name, value: c.value, path: c.path ?? "/", ...(c.domain ? { domain: c.domain } : { url: c.url ?? u?.origin ?? "about:blank" }) })) });
      }
      const tree = await page.send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
      mainFrame = tree.frameTree.frame.id;

      if (u) {
        const nav = await page.send<{ errorText?: string }>("Page.navigate", { url: u.href }, left());
        if (nav.errorText) throw new BrowserError("navigation_failed", nav.errorText.replace(/^net::/, ""));
      } else {
        await page.send("Page.setDocumentContent", { frameId: mainFrame, html: o.html });
        loaded = true;
      }
      for (;;) {
        const now = Date.now();
        if (now >= deadline) { if (!loaded) throw new BrowserError("timeout"); break; }
        if (loaded && inflight.size === 0 && now - lastActivity >= QUIET_MS) break;
        await sleep(Math.min(POLL_MS, deadline - now));
      }
      if (o.waitForSelector) {
        const until = Math.min(deadline + 5_000, Date.now() + (o.selectorTimeoutMs ?? 20_000));
        const expr = `!!document.querySelector(${JSON.stringify(o.waitForSelector)})`;
        for (;;) {
          const ev = await page.send<{ result?: { value?: boolean } }>("Runtime.evaluate", { expression: expr, returnByValue: true }, left() + 5_000);
          if (ev.result?.value === true) break;
          if (Date.now() >= until) throw new BrowserError("timeout", "the element never appeared");
          await sleep(POLL_MS);
        }
      }
      const shot = await page.send<{ data?: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, left() + 10_000);
      if (typeof shot.data !== "string" || !shot.data) throw new BrowserError("navigation_failed", "the browser made no picture");
      return Uint8Array.from(Buffer.from(shot.data, "base64"));
    } catch (err) {
      if (err instanceof BrowserError) throw err;
      if (err instanceof CdpError) {
        if (err.code === "closed") throw new BrowserError("crashed", "Chrome closed under the page");
        if (err.code === "timeout") throw new BrowserError("timeout", err.method);
        throw new BrowserError("navigation_failed", err.method);
      }
      throw err;
    } finally {
      for (const stopListening of stops) stopListening();
      if (contextId && !cdp.closed) await cdp.send("Target.disposeBrowserContext", { browserContextId: contextId }, undefined, 5_000).catch(() => {});
    }
  }

  // ------------------------------------------------------------ places and idling

  private async take(): Promise<void> {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.active < (this.o.maxConcurrent ?? 3)) { this.active += 1; return; }
    if (this.queue.length >= (this.o.maxQueued ?? 50)) throw new BrowserError("busy");
    await new Promise<void>((resolve) => this.queue.push(resolve)); // the place passes to us as it is given up
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) { next(); return; }
    this.active -= 1;
    if (this.active === 0) {
      this.idleTimer = setTimeout(() => { this.idleTimer = null; void this.stop(); }, this.o.idleMs ?? 60_000);
      this.idleTimer.unref?.();
    }
  }

  // ----------------------------------------------------------------- the browser

  private async ensure(): Promise<Running> {
    if (this.stopping) await this.stopping;
    if (this.running && this.running.alive) return this.running;
    if (this.running) await this.stop(); // it died: clear it away
    if (!this.starting) this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start(): Promise<Running> {
    const guard = await startGuard({
      ...this.o.guard,
      onRefuse: (host) => {
        this.refusals.push({ host, at: Date.now() });
        if (this.refusals.length > 200) this.refusals.splice(0, 100);
      },
    });
    let chrome: LaunchedChrome;
    try {
      chrome = await launch({ chromePath: this.o.chromePath, proxyPort: guard.port });
    } catch {
      await guard.close();
      throw new BrowserError("unavailable", "Chrome would not start");
    }
    let cdp: CdpClient;
    try {
      cdp = await CdpClient.connect(chrome.wsUrl);
    } catch {
      await chrome.close();
      await guard.close();
      throw new BrowserError("unavailable", "Chrome's DevTools could not be reached");
    }
    const run: Running = { guard, chrome, cdp, alive: true };
    const died = () => { run.alive = false; };
    cdp.onClosed(died);
    chrome.onExit(died);
    this.running = run;
    return run;
  }

  private stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const run = this.running;
    if (!run) return Promise.resolve();
    this.running = null;
    run.alive = false;
    this.stopping = (async () => {
      run.cdp.close();
      await run.chrome.close();
      await run.guard.close();
    })().finally(() => { this.stopping = null; });
    return this.stopping;
  }

  // ------------------------------------------------------------------ one page

  private async renderOnce(u: URL, opts: RenderOptions): Promise<RenderedPage> {
    const timeoutMs = opts.timeoutMs ?? RENDER_TIMEOUT_MS;
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    const left = () => Math.max(1_000, deadline - Date.now());
    const run = await this.ensure();
    const { cdp } = run;

    let contextId: string | undefined;
    const stops: Array<() => void> = [];
    try {
      contextId = (await cdp.send<{ browserContextId: string }>("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
      await cdp.send("Browser.setDownloadBehavior", { behavior: "deny", browserContextId: contextId });
      const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank", browserContextId: contextId });
      const page: CdpSession = await cdp.attach(targetId);

      // What the page is doing.
      const inflight = new Set<string>();
      let lastActivity = Date.now();
      const loadedLoaders = new Set<string>();
      let mainFrame = "";
      let blankLoader = "";
      let committed = false;
      let status: number | undefined;
      let guardBlocked = false;
      /** Every host the page's own document was asked of: the address, and each redirect on the way. */
      const navHosts = new Set<string>();

      stops.push(page.on("Network.requestWillBeSent", (p) => {
        if (!OPEN_ENDED.has(p.type)) inflight.add(p.requestId);
        lastActivity = Date.now();
        if (p.type === "Document" && p.frameId === mainFrame) {
          try { navHosts.add(new URL(p.request?.url).hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "")); } catch { /* not an address */ }
        }
      }));
      for (const done of ["Network.loadingFinished", "Network.loadingFailed"]) {
        stops.push(page.on(done, (p) => { inflight.delete(p.requestId); lastActivity = Date.now(); }));
      }
      stops.push(page.on("Network.responseReceived", (p) => {
        if (p.type === "Document" && p.frameId === mainFrame) {
          status = p.response?.status;
          const h = p.response?.headers ?? {};
          guardBlocked = Object.keys(h).some((k) => k.toLowerCase() === "x-tailzu-guard");
        }
      }));
      stops.push(page.on("Page.lifecycleEvent", (p) => {
        if (p.name === "load" && p.frameId === mainFrame && p.loaderId !== blankLoader) loadedLoaders.add(p.loaderId);
      }));
      stops.push(page.on("Page.frameNavigated", (p) => {
        if (!p.frame?.parentId && p.frame?.url && p.frame.url !== "about:blank") committed = true;
      }));
      stops.push(page.on("Page.javascriptDialogOpening", () => {
        page.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      }));

      await page.send("Page.enable");
      await page.send("Network.enable");
      await page.send("Page.setLifecycleEventsEnabled", { enabled: true });
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      if (this.o.userAgent) await page.send("Network.setUserAgentOverride", { userAgent: this.o.userAgent });
      if (opts.blockResources !== false) {
        stops.push(page.on("Fetch.requestPaused", (p) => {
          page.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {});
        }));
        await page.send("Fetch.enable", { patterns: ["Image", "Media", "Font"].map((resourceType) => ({ urlPattern: "*", resourceType })) });
      }

      const tree = await page.send<{ frameTree: { frame: { id: string; loaderId: string } } }>("Page.getFrameTree");
      mainFrame = tree.frameTree.frame.id;
      blankLoader = tree.frameTree.frame.loaderId;

      const nav = await page.send<{ errorText?: string }>("Page.navigate", { url: u.href }, left());
      if (nav.errorText) {
        // The guard turned the page away: its own 403 is seen (guardBlocked), or the tunnel it refused was for the page or one of its redirects.
        const refused = guardBlocked || this.refusals.some((r) => r.at >= startedAt && navHosts.has(r.host));
        throw new BrowserError(refused ? "blocked" : "navigation_failed", nav.errorText.replace(/^net::/, ""));
      }

      // The load event, then half a second with nothing on the wire; the time limit wins over both.
      for (;;) {
        const now = Date.now();
        if (now >= deadline) break;
        if (loadedLoaders.size > 0 && inflight.size === 0 && now - lastActivity >= QUIET_MS) break;
        await sleep(Math.min(POLL_MS, deadline - now));
      }
      if (guardBlocked) throw new BrowserError("blocked");
      if (!committed && loadedLoaders.size === 0 && status === undefined) throw new BrowserError("timeout");

      const ev = await page.send<{ result?: { value?: { html: string; title: string; href: string } }; exceptionDetails?: unknown }>(
        "Runtime.evaluate", { expression: SNAPSHOT, returnByValue: true }, left() + 5_000,
      );
      const v = ev.result?.value;
      if (ev.exceptionDetails || !v || typeof v.html !== "string") throw new BrowserError("navigation_failed", "the page could not be read");
      // Chrome's own error pages are not the page.
      if (v.href.startsWith("chrome-error:")) throw new BrowserError("navigation_failed", "the page did not load");

      let finalUrl = u.href;
      try { const f = new URL(v.href); if (f.protocol === "http:" || f.protocol === "https:") finalUrl = f.href; } catch { /* keep what was asked for */ }
      return { html: v.html, finalUrl, title: String(v.title ?? ""), status: status ?? 200 };
    } catch (err) {
      if (err instanceof BrowserError) throw err;
      if (err instanceof CdpError) {
        if (err.code === "closed") throw new BrowserError("crashed", "Chrome closed under the page");
        if (err.code === "timeout") throw new BrowserError("timeout", err.method);
        throw new BrowserError("navigation_failed", err.method);
      }
      throw err;
    } finally {
      for (const stopListening of stops) stopListening();
      if (contextId && !cdp.closed) {
        await cdp.send("Target.disposeBrowserContext", { browserContextId: contextId }, undefined, 5_000).catch(() => {});
      }
    }
  }
}

/** The engine as readPage takes it. */
export function rendererFrom(engine: BrowserEngine): Renderer {
  return (url, opts) => engine.render(url, opts);
}
