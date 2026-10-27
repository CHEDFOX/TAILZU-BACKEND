import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";

const VIEWER = "http://127.0.0.1:8799/";
// Three pages on three ports (three origins): the app the viewer is configured for, an app it is not configured for, and a bystander.
const APP = 8801;
const STRANGER = 8802;
const SIBLING = 8803;

const appPage = (extra = ""): string => `<!doctype html><meta charset=utf-8><body>
<iframe id="viewer" sandbox="allow-scripts" src="${VIEWER}" style="width:600px;height:300px"></iframe>
<script>
  window.got = [];
  window.addEventListener("message", function (e) { if (e.source === document.getElementById("viewer").contentWindow) got.push({ origin: e.origin, msg: e.data }); });
</script>${extra}</body>`;

const sibling = `<script>window.addEventListener("message", function (e) { if (e.data === "go") {
  parent.frames[0].postMessage({ t: "load", artifact: { id: "evil", version: 1, type: "markdown", title: "evil", content: "# HIJACKED" } }, "*");
  parent.frames[0].postMessage({ t: "storage-result", reqId: "x", ok: true, value: "forged" }, "*");
} });</script>`;

const servers: Server[] = [];
const serve = (port: number, body: string): Promise<void> =>
  new Promise((resolve) => {
    const s = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(body);
    });
    servers.push(s);
    s.listen(port, "127.0.0.1", () => resolve());
  });

test.beforeAll(async () => {
  await serve(APP, appPage(`<iframe id="sibling" src="http://127.0.0.1:${SIBLING}/"></iframe>`));
  await serve(STRANGER, appPage());
  await serve(SIBLING, sibling);
});
test.afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(undefined)))));
});

test("only the configured app origin may embed the viewer; any other page gets an empty frame, not the viewer", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${STRANGER}/`);
  await page.waitForTimeout(1500);
  const viewer = page.frames().find((f) => f !== page.mainFrame());
  expect(viewer?.url()).toMatch(/^chrome-error:/); // the browser refused to show it: frame-ancestors lists only the app
  expect(await page.evaluate(() => (window as any).got.length)).toBe(0);
});

test("the configured app origin gets `ready`, can load an artifact, and nobody else can drive the viewer", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${APP}/`);
  await page.waitForFunction(() => (window as any).got.some((g: any) => g.msg.t === "ready"));
  const ready = await page.evaluate(() => (window as any).got.find((g: any) => g.msg.t === "ready"));
  expect(ready.origin).toBe("null"); // the viewer's opaque origin: the app must recognise it by the window, not by the origin
  expect(ready.msg.protocol).toBe(1);

  await page.evaluate(() => (document.getElementById("viewer") as HTMLIFrameElement).contentWindow!.postMessage({ t: "load", artifact: { id: "a", version: 1, type: "markdown", title: "t", content: "# Real" } }, "*"));
  await page.waitForFunction(() => (window as any).got.some((g: any) => g.msg.t === "rendered"));
  const real = page.frameLocator("#viewer");
  await expect(real.locator("h1")).toHaveText("Real");

  // A sibling frame (another origin) reaches the viewer's window and pushes its own artifact: ignored.
  const sib = page.frames().find((f) => f.url().startsWith(`http://127.0.0.1:${SIBLING}`));
  expect(sib).toBeTruthy();
  await sib!.evaluate(() => window.postMessage("go", "*"));
  await page.waitForTimeout(600);
  await expect(real.locator("h1")).toHaveText("Real");
  expect(await page.evaluate(() => (window as any).got.filter((g: any) => g.msg.t === "rendered").length)).toBe(1);
});

test("frame-ancestors names exactly the configured app (and, in development, the test host)", async ({ page }) => {
  // The stranger page cannot embed the viewer, so the only thing to check is that the allowed origin is what `ready` is addressed to:
  // the app page above received it. Here: the frame-ancestors header names exactly the configured app (and, in development, the host page).
  const res = await page.request.get("/");
  expect(res.headers()["content-security-policy"]).toContain(`frame-ancestors http://127.0.0.1:${APP} http://127.0.0.1:8799`);
});

test("the shell never sets a cookie and its template is not reachable without the CSP", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["set-cookie"]).toBeUndefined();
  const template = await request.get("/shell.html");
  expect(template.status()).toBe(404);
  const host = await request.get("/__host");
  expect(host.status()).toBe(200); // development: on (the workerd tests check that production turns it off)
});

test("a cookie on the viewer's origin is never read, sent on, or echoed (the viewer holds no credential of any kind)", async ({ page, context }) => {
  // A made-up credential, built at run time.
  const fake = ["tz", Math.random().toString(36).slice(2), "x".repeat(8)].join("_");
  await context.addCookies([{ name: "session", value: fake, url: "http://127.0.0.1:8799/" }]);
  const sent: string[] = [];
  page.on("request", (r) => {
    const h = r.headers();
    if (r.url().includes("/assets/") || r.url().includes("/vendor/")) sent.push(`${h["cookie"] ?? ""}${h["authorization"] ?? ""}`);
  });
  await page.goto("/__host");
  await page.waitForFunction(() => window.host.log.some((e) => e.msg.t === "ready"));
  await page.evaluate(() => window.host.load({ type: "react", content: `export default () => <p id="p">{document.cookie === undefined ? "?" : "?"}</p>;` }));
  await page.evaluate(() => window.host.waitFor((m) => m.t === "rendered" || m.t === "error"));
  // The artifact could not read it (opaque origin: document.cookie throws), the responses do not repeat it, no message to the app carries it.
  const res = await page.request.get("/", { headers: { cookie: `session=${fake}` } });
  expect(await res.text()).not.toContain(fake);
  expect(JSON.stringify(res.headers())).not.toContain(fake);
  expect(res.headers()["set-cookie"]).toBeUndefined();
  expect(JSON.stringify(await page.evaluate(() => window.host.log.map((e) => e.msg)))).not.toContain(fake);
  // Requests for the runtime and the libraries are made without credentials (the frame's origin is opaque).
  expect(sent.length).toBeGreaterThan(3);
  expect(sent.join("")).not.toContain(fake);
});
