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
import { BrowserError, type BrowserErrorCode, type RenderOptions, type RenderedPage, type Renderer, type HeldPage, type ShotOptions, type SiteState, type VisitElement, type VisitOptions, type VisitedPage } from "./types.js";

export { BrowserError };
export type { BrowserErrorCode, RenderOptions, RenderedPage, Renderer, HeldPage, ShotOptions, SiteState, VisitElement, VisitOptions, VisitedPage };

/**
 * THE THREE SCRIPTS THAT RUN INSIDE THE PAGE (visit()). Plain strings, stringified into Runtime.evaluate, so they
 * are ES5-ish on purpose and may not close over anything out here.
 */

/** Put a saved localStorage/sessionStorage back, once its origin is open. Quota and privacy errors are shrugged off. */
const PUT_STORAGE = `function (rows) {
  var origin = location.origin;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r[0] !== origin) continue;
    try { localStorage.setItem(r[1], r[2]); } catch (e) {}
  }
  return true;
}`;

/** Take this origin's localStorage back out, capped so one fat key cannot fill a row. */
const TAKE_STORAGE = `function () {
  var out = [], origin = location.origin, n = 0;
  try {
    for (var i = 0; i < localStorage.length && n < 200; i++) {
      var k = localStorage.key(i); if (k === null) continue;
      var v = localStorage.getItem(k); if (v === null || v.length > 8000) continue;
      out.push([origin, k, v]); n++;
    }
  } catch (e) {}
  return out;
}`;

/**
 * WHAT IS ON THE PAGE, as a person would see it: the words, and the things that can be acted on, in reading order.
 * Judged on COMPUTED style so a node hidden by a stylesheet is gone, which an HTML scrape cannot tell.
 *
 * The ids are e1..eN in document order, the same shape the planner reads everywhere else, so a page and a Mac
 * window arrive at the model looking the same.
 */
const READ_PAGE = `function () {
  var MAX_EL = 250, MAX_TEXT = 20000, MAX_LABEL = 120;
  var seen = 0, els = [];
  function visible(el) {
    try {
      // A PARENT'S opacity and visibility do not appear in the child's computed style, so checking the element
      // alone let a whole faded-out subtree through. checkVisibility walks the ancestors; the rect is the backstop
      // for anything laid out to nothing, and for a browser too old to have it.
      if (typeof el.checkVisibility === "function"
        && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      var s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return (r.width > 1 && r.height > 1) || el.tagName === "OPTION";
    } catch (e) { return false; }
  }
  function clean(t) { return (t || "").replace(/\\s+/g, " ").trim().slice(0, MAX_LABEL); }
  function labelOf(el) {
    var a = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt");
    if (a) return clean(a);
    if (el.id) { try { var l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return clean(l.innerText); } catch (e) {} }
    var own = el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" ? "" : clean(el.innerText);
    return own;
  }
  function roleOf(el) {
    var t = el.tagName, ty = (el.getAttribute("type") || "").toLowerCase();
    if (t === "A") return "link";
    if (t === "BUTTON" || (t === "INPUT" && (ty === "submit" || ty === "button"))) return "button";
    if (t === "SELECT") return "combo";
    if (t === "TEXTAREA") return "area";
    if (t === "INPUT") {
      if (ty === "checkbox") return "check";
      if (ty === "radio") return "radio";
      if (ty === "hidden") return "";
      // Its own role, because "field" would let a password be drawn as an ordinary box in a card.
      if (ty === "password") return "secret";
      return "field";
    }
    var r = (el.getAttribute("role") || "").toLowerCase();
    if (r === "button" || r === "link" || r === "tab" || r === "checkbox" || r === "radio" || r === "menuitem") return r;
    return "";
  }
  var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, null);
  var el = walker.currentNode;
  while (el && seen < MAX_EL) {
    if (el.nodeType === 1 && visible(el)) {
      var role = roleOf(el);
      if (role) {
        var item = { id: "e" + (seen + 1), role: role };
        var lab = labelOf(el); if (lab) item.label = lab;
        // A password's value is never read, here or anywhere.
        var ty2 = (el.getAttribute("type") || "").toLowerCase();
        var noValue = ty2 === "password" || ty2 === "checkbox" || ty2 === "radio";
        if (!noValue && typeof el.value === "string" && el.value) item.value = clean(el.value);
        if (el.checked === true) item.checked = true;
        els.push(item); seen++;
      }
    }
    el = walker.nextNode();
  }
  var text = "";
  try { text = ((document.body && document.body.innerText) || "").replace(/[ \\t]+/g, " ").replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, MAX_TEXT); } catch (e) {}
  return { title: (document.title || "").slice(0, 200), url: location.href, text: text, elements: els };
}`;

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

const RENDER_TIMEOUT_MS = 20_000;
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

  // ------------------------------------------------------------ a page visited AS SOMEBODY (src/sites, docs/sites.md)

  /**
   * OPEN A PAGE AS SOMEONE WHO IS SIGNED IN, READ IT, AND HAND THE SESSION BACK.
   *
   * The browser keeps nothing between visits. A fresh context is made, filled from `state`, navigated, read, and
   * thrown away — exactly as render() does — and the session that comes back out is saved by the caller. So there
   * is no live browser holding anybody's login, nothing to expire on a timer, and a crash costs a visit rather
   * than a sign-in.
   *
   * Carrying the state back out is not optional: a site refreshes its own cookies as it is used, so writing back
   * only what you sent in makes the slip go stale and signs them out within days.
   *
   * Reads only. There is no clicking or typing here, which is why it is the safe half: the worst a bad page can do
   * is be misread, and a misread card is wrong rather than expensive.
   */
  async visit(o: VisitOptions): Promise<VisitedPage> {
    let u: URL;
    try { u = new URL(o.url); } catch { throw new BrowserError("bad_url"); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new BrowserError("bad_url");
    const bare = u.hostname.replace(/^\[|\]$/g, "");
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (net.isIP(bare) && isBlockedAddress(bare) && !this.o.guard?.allow?.(bare.toLowerCase(), port)) throw new BrowserError("blocked");
    await this.take();
    try {
      try {
        return await this.visitOnce(u, o);
      } catch (err) {
        if (err instanceof BrowserError && err.code === "crashed") return await this.visitOnce(u, o);
        throw err;
      }
    } finally {
      this.release();
    }
  }

  private async visitOnce(u: URL, o: VisitOptions): Promise<VisitedPage> {
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

      const view = o.viewport ?? { width: 412, height: 915, mobile: true };
      await page.send("Page.enable");
      await page.send("Network.enable");
      await page.send("Runtime.enable");
      await page.send("Page.setLifecycleEventsEnabled", { enabled: true });
      await page.send("Emulation.setDeviceMetricsOverride", { width: view.width, height: view.height, deviceScaleFactor: 1, mobile: view.mobile === true });
      if (this.o.userAgent) await page.send("Network.setUserAgentOverride", { userAgent: this.o.userAgent });
      if (o.allow) await page.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

      // Who to be, part one: the cookies, before anything is asked for.
      const cookies = Array.isArray(o.state?.cookies) ? o.state!.cookies : [];
      if (cookies.length) await page.send("Network.setCookies", { cookies }).catch(() => {});

      const tree = await page.send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
      mainFrame = tree.frameTree.frame.id;

      // Who to be, part two: localStorage, which cookies alone no longer carry. It can only be written once an
      // origin is open, so the origin is opened first and the real page second.
      const storage = o.state?.storage ?? [];
      if (storage.length) {
        await page.send<{ errorText?: string }>("Page.navigate", { url: u.origin + "/" }, left()).catch(() => {});
        await this.settle(() => loaded, () => inflight.size, () => lastActivity, Math.min(deadline, Date.now() + 15_000));
        await page.send("Runtime.evaluate", {
          expression: `(${PUT_STORAGE})(${JSON.stringify(storage.filter((r) => Array.isArray(r) && r.length === 3))})`,
          returnByValue: true,
        }, left()).catch(() => {});
        loaded = false;
      }

      const nav = await page.send<{ errorText?: string }>("Page.navigate", { url: u.href }, left());
      if (nav.errorText) throw new BrowserError("navigation_failed", nav.errorText.replace(/^net::/, ""));
      await this.settle(() => loaded, () => inflight.size, () => lastActivity, deadline);

      const read = await page.send<{ result?: { value?: { title: string; url: string; text: string; elements: VisitElement[] } } }>(
        "Runtime.evaluate", { expression: `(${READ_PAGE})()`, returnByValue: true }, left() + 10_000);
      const got = read.result?.value;
      if (!got) throw new BrowserError("navigation_failed", "the page could not be read");

      // The session as it stands now, which is not the one that went in.
      const after = await page.send<{ cookies?: unknown[] }>("Network.getAllCookies", {}, left() + 5_000).catch(() => ({ cookies: [] }));
      const keep = await page.send<{ result?: { value?: Array<[string, string, string]> } }>(
        "Runtime.evaluate", { expression: `(${TAKE_STORAGE})()`, returnByValue: true }, left() + 5_000).catch(() => ({ result: { value: [] } }));

      const state: SiteState = {
        cookies: Array.isArray(after.cookies) ? after.cookies : [],
        ...(keep.result?.value?.length ? { storage: keep.result.value } : {}),
      };
      return { finalUrl: got.url || u.href, title: got.title ?? "", text: got.text ?? "", elements: got.elements ?? [], state };
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

  /** Loaded, and nothing in flight for QUIET_MS, inside the deadline. A page that shows but never settles is read as it stands. */
  private async settle(loaded: () => boolean, inflight: () => number, lastActivity: () => number, deadline: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      if (now >= deadline) { if (!loaded()) throw new BrowserError("timeout"); return; }
      if (loaded() && inflight() === 0 && now - lastActivity() >= QUIET_MS) return;
      await sleep(Math.min(POLL_MS, deadline - now));
    }
  }

  // ------------------------------------------------------------ a page HELD OPEN while a person looks at it

  /**
   * OPEN A PAGE AND KEEP IT, for the seconds somebody spends signing in (src/sites/panel.ts, docs/sites.md §panel).
   *
   * The only thing in this file that outlives its call. It holds one of the engine's places the whole time, which is
   * why the panel above it has an idle cut and a ceiling: a forgotten panel is a place nobody else can use.
   *
   * Input is dispatched as real events — a press and a release for a tap, a key at a time for text — because a
   * sign-in page watches for them. A box that jumps to the next digit on each keystroke does nothing at all if the
   * value is simply set.
   */
  async hold(o: { url: string; state?: SiteState; viewport?: { width: number; height: number }; allow?: RegExp[] }): Promise<HeldPage> {
    let u: URL;
    try { u = new URL(o.url); } catch { throw new BrowserError("bad_url"); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new BrowserError("bad_url");
    const bare = u.hostname.replace(/^\[|\]$/g, "");
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (net.isIP(bare) && isBlockedAddress(bare) && !this.o.guard?.allow?.(bare.toLowerCase(), port)) throw new BrowserError("blocked");

    await this.take();
    const run = await this.ensure();
    const { cdp } = run;
    const stops: Array<() => void> = [];
    let contextId: string | undefined;
    let released = false;
    const view = o.viewport ?? { width: 412, height: 915 };

    const letGo = async (): Promise<void> => {
      if (released) return;
      released = true;
      for (const stop of stops) stop();
      if (contextId && !cdp.closed) await cdp.send("Target.disposeBrowserContext", { browserContextId: contextId }, undefined, 5_000).catch(() => {});
      this.release();
    };

    try {
      contextId = (await cdp.send<{ browserContextId: string }>("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
      await cdp.send("Browser.setDownloadBehavior", { behavior: "deny", browserContextId: contextId });
      const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank", browserContextId: contextId });
      const page: CdpSession = await cdp.attach(targetId);

      stops.push(page.on("Page.javascriptDialogOpening", () => { page.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {}); }));
      if (o.allow) {
        const allow = o.allow;
        // While a person is looking, the page may reach only where the panel says. This is what keeps a sign-in
        // panel from wandering somewhere else entirely, and it is the same allowlist shots already use.
        stops.push(page.on("Fetch.requestPaused", (p) => {
          const url = String(p.request?.url ?? "");
          if (allow.some((re) => re.test(url))) page.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
          else page.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {});
        }));
      }

      await page.send("Page.enable");
      await page.send("Network.enable");
      await page.send("Runtime.enable");
      await page.send("Emulation.setDeviceMetricsOverride", { width: view.width, height: view.height, deviceScaleFactor: 2, mobile: true });
      if (this.o.userAgent) await page.send("Network.setUserAgentOverride", { userAgent: this.o.userAgent });
      if (o.allow) await page.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      const cookies = Array.isArray(o.state?.cookies) ? o.state!.cookies : [];
      if (cookies.length) await page.send("Network.setCookies", { cookies }).catch(() => {});

      await page.send<{ errorText?: string }>("Page.navigate", { url: u.href }, 30_000);

      let onFrame: ((jpeg: string, meta: { width: number; height: number }) => void) | null = null;
      stops.push(page.on("Page.screencastFrame", (p) => {
        const data = String((p as { data?: string }).data ?? "");
        const sid = (p as { sessionId?: number }).sessionId;
        // Acknowledged at once whatever we do with it: an unacknowledged frame stops Chrome sending the next.
        if (sid !== undefined) page.send("Page.screencastFrameAck", { sessionId: sid }).catch(() => {});
        const md = (p as { metadata?: { deviceWidth?: number; deviceHeight?: number } }).metadata ?? {};
        if (data && onFrame) onFrame(data, { width: Number(md.deviceWidth ?? view.width), height: Number(md.deviceHeight ?? view.height) });
      }));
      // quality 60 is plenty for reading a form on a phone, and a third of the bytes of 90.
      await page.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: view.width, maxHeight: view.height, everyNthFrame: 1 });

      const held: HeldPage = {
        onFrame(cb) { onFrame = cb; },
        async tap(x, y) {
          for (const type of ["mousePressed", "mouseReleased"] as const) {
            await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, 5_000).catch(() => {});
          }
        },
        async type(text) {
          for (const ch of [...text].slice(0, 200)) {
            await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch }, 5_000).catch(() => {});
            await page.send("Input.dispatchKeyEvent", { type: "keyUp", text: ch }, 5_000).catch(() => {});
          }
        },
        async key(name) {
          const codes = { Enter: 13, Backspace: 8, Tab: 9 } as const;
          for (const type of ["keyDown", "keyUp"] as const) {
            await page.send("Input.dispatchKeyEvent", { type, key: name, windowsVirtualKeyCode: codes[name], nativeVirtualKeyCode: codes[name] }, 5_000).catch(() => {});
          }
        },
        async scroll(dy) {
          await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: view.width / 2, y: view.height / 2, deltaX: 0, deltaY: dy }, 5_000).catch(() => {});
        },
        async look() {
          const r = await page.send<{ result?: { value?: { title: string; url: string; elements: VisitElement[] } } }>(
            "Runtime.evaluate", { expression: `(${READ_PAGE})()`, returnByValue: true }, 15_000).catch(() => null);
          const v = r?.result?.value;
          return { finalUrl: v?.url ?? u.href, title: v?.title ?? "", elements: v?.elements ?? [] };
        },
        async state() {
          const after = await page.send<{ cookies?: unknown[] }>("Network.getAllCookies", {}, 10_000).catch(() => ({ cookies: [] }));
          const keep = await page.send<{ result?: { value?: Array<[string, string, string]> } }>(
            "Runtime.evaluate", { expression: `(${TAKE_STORAGE})()`, returnByValue: true }, 10_000).catch(() => ({ result: { value: [] } }));
          return {
            cookies: Array.isArray(after.cookies) ? after.cookies : [],
            ...(keep.result?.value?.length ? { storage: keep.result.value } : {}),
          };
        },
        async forgetHost(host) {
          // Everything of one host, gone: the cookies and the storage both. Used to throw Google's session away the
          // moment the handshake is done and keep only the shop's, which is the whole safety of a social sign-in.
          const h = host.toLowerCase();
          const got = await page.send<{ cookies?: Array<{ name: string; domain: string; path?: string }> }>("Network.getAllCookies", {}, 10_000).catch(() => ({ cookies: [] }));
          for (const c of got.cookies ?? []) {
            const d = String(c.domain ?? "").replace(/^\./, "").toLowerCase();
            if (d === h || d.endsWith(`.${h}`)) {
              await page.send("Network.deleteCookies", { name: c.name, domain: c.domain, ...(c.path ? { path: c.path } : {}) }, 5_000).catch(() => {});
            }
          }
          await page.send("Storage.clearDataForOrigin", { origin: `https://${h}`, storageTypes: "all" }, 10_000).catch(() => {});
        },
        close: letGo,
      };
      return held;
    } catch (err) {
      await letGo();
      if (err instanceof BrowserError) throw err;
      if (err instanceof CdpError) throw new BrowserError(err.code === "closed" ? "crashed" : "navigation_failed", err.method);
      throw err;
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
