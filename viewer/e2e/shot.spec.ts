import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { shotHostHtml } from "../../tulmi/src/artifacts/shothost.js";

// The viewer kept for screenshots (docs section 14) is on 8798 with VIEWER_PARENT_ORIGINS=null. The normal one is on 8799 (playwright.config.ts).
const SHOT_VIEWER = "http://127.0.0.1:8798/";
const NORMAL_VIEWER = "http://127.0.0.1:8799/";
const STRANGER = 8804;

const ARTIFACT = {
  id: "art-shot",
  version: 1,
  type: "html" as const,
  title: "Shot",
  content: '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#102a43"><h1 id="hello" style="color:#fff;font:700 40px sans-serif;padding:24px">Hello shot</h1></body>',
};
const MOBILE = { width: 390, height: 844 };

const hostHtml = (viewerUrl: string, over: { type?: "html" | "react"; content?: string } = {}): string =>
  shotHostHtml({ viewerUrl, artifact: { ...ARTIFACT, ...over }, viewport: MOBILE, settleMs: 50 });

const events = (page: import("@playwright/test").Page): Promise<string[]> => page.evaluate(() => (window as any).__shot.events as string[]);

const servers: Server[] = [];
test.beforeAll(async () => {
  // A page that is not opaque: an ordinary http origin that frames the shot viewer and tries to drive it.
  const html = `<!doctype html><meta charset=utf-8><body>
<iframe id="v" src="${SHOT_VIEWER}" style="width:390px;height:400px"></iframe>
<script>
  window.got = [];
  var v = document.getElementById("v");
  window.addEventListener("message", function (e) {
    if (e.source !== v.contentWindow) return;
    got.push(e.data.t);
    if (e.data.t === "ready") v.contentWindow.postMessage({ t: "load", artifact: { id: "x", version: 1, type: "markdown", title: "x", content: "# DRIVEN" } }, "*");
  });
</script></body>`;
  await new Promise<void>((resolve) => {
    const s = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    });
    servers.push(s);
    s.listen(STRANGER, "127.0.0.1", () => resolve());
  });
});
test.afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(undefined)))));
});

test.describe("shot mode: the viewer kept for screenshots", () => {
  test("serves a policy without frame-ancestors, and the rest of it as strict as ever", async ({ request }) => {
    const res = await request.get(SHOT_VIEWER);
    const policy = res.headers()["content-security-policy"]!;
    expect(policy).not.toContain("frame-ancestors");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("sandbox allow-scripts");
    expect(await res.text()).toContain('<meta name="tz-parents" content="null">');
  });

  test("a page made from inline HTML (opaque origin) drives it: ready, load, rendered, then `#done`, and the picture shows the artifact", async ({ page }) => {
    await page.setContent(hostHtml(SHOT_VIEWER));
    await page.waitForSelector("#done", { state: "attached", timeout: 30_000 });
    expect(await events(page)).toEqual(expect.arrayContaining(["ready", "rendered"]));
    const text = await page.frameLocator("#v").frameLocator("iframe.tz-frame").locator("#hello").innerText();
    expect(text).toBe("Hello shot");
    const png = await page.screenshot();
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // The frame is exactly the viewport of the shot.
    const box = await page.locator("#v").boundingBox();
    expect(box).toMatchObject({ width: MOBILE.width, height: MOBILE.height });
  });

  test("an artifact that does not render never gets `#done`: the shot times out instead of drawing something wrong", async ({ page }) => {
    await page.setContent(hostHtml(SHOT_VIEWER, { type: "react", content: "export default function App( {" }));
    // The viewer got the artifact (it says why it cannot show it) and never says `rendered`.
    await page.waitForFunction(() => (window as any).__shot.events.includes("error"), undefined, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const seen = await events(page);
    expect(seen).toContain("ready");
    expect(seen).not.toContain("rendered");
    expect(await page.locator("#done").count()).toBe(0);
  });

  test("the normal viewer refuses the same page: its frame is empty and `ready` never comes", async ({ page }) => {
    await page.setContent(hostHtml(NORMAL_VIEWER));
    await page.waitForTimeout(2000);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    expect(frame?.url()).toMatch(/^chrome-error:/);
    expect(await events(page)).toEqual([]);
    expect(await page.locator("#done").count()).toBe(0);
  });

  test("an ordinary page can frame it, hears `ready`, but cannot drive it: only an opaque parent is believed", async ({ page }) => {
    await page.goto(`http://127.0.0.1:${STRANGER}/`);
    await page.waitForFunction(() => (window as any).got.includes("ready"));
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (window as any).got)).toEqual(["ready"]);
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    expect(frame.url()).toBe(SHOT_VIEWER);
    expect(await frame.locator("body").innerText()).not.toContain("DRIVEN");
  });
});
