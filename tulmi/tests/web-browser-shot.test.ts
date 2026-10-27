/**
 * The browser engine's SCREENSHOT (src/web/browser/engine.ts `screenshot`), the fallback shots.ts uses with WEB_BROWSER=local: a real headless Chrome,
 * a page server of our own on 127.0.0.1, the guard told to let Chrome dial that one port. Skipped where there is no Chrome.
 *
 * What it holds down: the viewport is the size of the picture (a phone's and a desktop's); the page is waited for (the load, then the selector the
 * caller named, and a selector that never comes is "timeout"); cookies are held while the page loads; `html` is shown in a blank page; and `allow`
 * turns away a request that matches none of its patterns before it leaves.
 */
import http from "node:http";
import type net from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { BrowserEngine, BrowserError, findChrome } = await import("../src/web/browser/index.js");
const { decodePng } = await import("../src/artifacts/pixels.js");

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const chromePath = findChrome({ chromePath: process.env.CHROME_PATH });

describe.skipIf(!chromePath)("the engine's screenshot", () => {
  let server: http.Server;
  let port = 0;
  const hits: Array<{ path: string; cookie: string | undefined }> = [];
  let engine: InstanceType<typeof BrowserEngine>;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      hits.push({ path: url.pathname, cookie: req.headers.cookie });
      res.setHeader("content-type", "text/html");
      if (url.pathname === "/blue") res.end('<!doctype html><body style="margin:0;background:#0000ff"><div id="x" style="width:40px;height:40px;background:#ff0000"></div></body>');
      else if (url.pathname === "/late") res.end('<!doctype html><body style="margin:0;background:#fff"><script>setTimeout(function(){document.body.style.background="#00ff00";var d=document.createElement("div");d.id="late";document.body.appendChild(d)},900)</script></body>');
      else if (url.pathname === "/never") res.end("<!doctype html><body>nothing comes</body>");
      else if (url.pathname === "/pixel.png") { res.setHeader("content-type", "image/png"); res.end(Buffer.from("iVBORw0KGgo=", "base64")); }
      else res.end("<!doctype html><body>ok</body>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as net.AddressInfo).port;
    engine = new BrowserEngine({ chromePath: chromePath!, guard: { allow: (h, p) => h === "127.0.0.1" && p === port, resolve: () => [] } });
  });
  afterAll(async () => { await engine?.close(); await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }); });

  const px = (png: Uint8Array, x: number, y: number): number[] => { const r = decodePng(png); const o = (y * r.width + x) * 4; return [r.data[o]!, r.data[o + 1]!, r.data[o + 2]!]; };
  const url = (p: string) => `http://127.0.0.1:${port}${p}`;

  it("is the size of the viewport, for a phone and for a desktop, and shows the page", async () => {
    const phone = await engine.screenshot({ url: url("/blue"), viewport: { width: 390, height: 844, mobile: true } });
    const img = decodePng(phone);
    expect([img.width, img.height]).toEqual([390, 844]);
    expect(px(phone, 5, 5)).toEqual([255, 0, 0]);
    expect(px(phone, 200, 400)).toEqual([0, 0, 255]);
    const desk = decodePng(await engine.screenshot({ url: url("/blue"), viewport: { width: 1280, height: 800 } }));
    expect([desk.width, desk.height]).toEqual([1280, 800]);
  });

  it("waits for the selector the caller names, and says timeout when it never comes", async () => {
    const shot = await engine.screenshot({ url: url("/late"), viewport: { width: 200, height: 200 }, waitForSelector: "#late" });
    expect(px(shot, 100, 100)).toEqual([0, 255, 0]);
    await expect(engine.screenshot({ url: url("/never"), viewport: { width: 200, height: 200 }, waitForSelector: "#nope", selectorTimeoutMs: 1_200 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("holds cookies while the page loads", async () => {
    hits.length = 0;
    await engine.screenshot({ url: url("/ok"), viewport: { width: 200, height: 200 }, cookies: [{ name: "tzpv", value: "abc" }] });
    expect(hits.find((h) => h.path === "/ok")?.cookie).toBe("tzpv=abc");
  });

  it("shows html in a blank page, and with `allow` refuses every request that matches none of the patterns", async () => {
    const html = `<!doctype html><body style="margin:0;background:#ff00ff"><img src="${url("/pixel.png")}"><div id="done"></div></body>`;
    hits.length = 0;
    const shot = await engine.screenshot({ html, viewport: { width: 100, height: 100 }, waitForSelector: "#done" });
    expect(px(shot, 90, 90)).toEqual([255, 0, 255]);
    expect(hits.some((h) => h.path === "/pixel.png")).toBe(true);
    hits.length = 0;
    const closed = await engine.screenshot({ html, viewport: { width: 100, height: 100 }, waitForSelector: "#done", allow: [/^about:/, /^data:/] });
    expect(px(closed, 90, 90)).toEqual([255, 0, 255]);
    expect(hits).toEqual([]);
    hits.length = 0;
    await engine.screenshot({ html, viewport: { width: 100, height: 100 }, waitForSelector: "#done", allow: [new RegExp(`^http://127\\.0\\.0\\.1:${port}/`)] });
    expect(hits.some((h) => h.path === "/pixel.png")).toBe(true);
  });

  it("is of an address or of html, not both and not neither; and only of http(s)", async () => {
    await expect(engine.screenshot({ viewport: { width: 10, height: 10 } })).rejects.toBeInstanceOf(BrowserError);
    await expect(engine.screenshot({ url: url("/"), html: "<b>x</b>", viewport: { width: 10, height: 10 } })).rejects.toMatchObject({ code: "bad_url" });
    await expect(engine.screenshot({ url: "file:///etc/passwd", viewport: { width: 10, height: 10 } })).rejects.toMatchObject({ code: "bad_url" });
    await expect(engine.screenshot({ url: "http://169.254.169.254/", viewport: { width: 10, height: 10 } })).rejects.toMatchObject({ code: "blocked" });
  });
});
