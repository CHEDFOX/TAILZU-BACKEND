import { expect, test } from "@playwright/test";
import { htmlDoc, load, logLength, openHost, viewer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openHost(page);
});

/** The `open` messages the viewer sent after log index `from`. */
const opens = (page: import("@playwright/test").Page, from: number): Promise<string[]> =>
  page.evaluate((f) => window.host.messages("open", f).map((m: any) => m.url), from);

/** Nothing moved: the host page is where it was, the viewer frame is the viewer, no error (a navigated-away frame reports one from pagehide). */
async function stayedPut(page: import("@playwright/test").Page, from: number): Promise<void> {
  await page.waitForTimeout(250);
  expect(page.url()).toMatch(/\/__host$/);
  const frame = page.frames().find((f) => f.parentFrame() === page.mainFrame());
  expect(frame?.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/(\?type=\w+)?(#\w*)?$/);
  expect(await page.evaluate((f) => window.host.messages("error", f), from)).toEqual([]);
}

const REACT = `export default function App() {
  const [n, setN] = useState(0);
  return (
    <main>
      <a id="ext" href="https://example.com/docs?x=1#top">docs</a>
      <a id="plain" href="http://example.org/plain">plain</a>
      <a id="rel" href="/local/page">relative</a>
      <a id="mail" href="mailto:a@b.example">mail</a>
      <a id="js" href="javascript:alert(1)">js</a>
      <a id="cred" href="https://bank.example@evil.example/">cred</a>
      <a id="hash" href="#bottom">hash</a>
      <a id="stop" href="https://example.com/stopped" onClick={(e) => e.stopPropagation()}>stop</a>
      <a id="handled" href="https://example.com/handled" onClick={(e) => { e.preventDefault(); setN(n + 1); }}>handled {n}</a>
      <button id="win" onClick={() => window.open("https://example.com/from-window")}>window.open</button>
      <button id="bad" onClick={() => window.open("javascript:alert(1)")}>window.open bad</button>
      <div style={{ height: 1500 }} />
      <p id="bottom">bottom</p>
    </main>
  );
}
`.replace("export default function", "import { useState } from 'react';\nexport default function");

test.describe("links: the viewer asks, the app opens", () => {
  test("react: a click on an absolute link sends `open` and nothing navigates", async ({ page }) => {
    await load(page, { type: "react", content: REACT });
    const v = viewer(page);
    const from = await logLength(page);

    await v.locator("#ext").click();
    await expect.poll(() => opens(page, from)).toEqual(["https://example.com/docs?x=1#top"]);
    await stayedPut(page, from);

    // http is fine too; the address comes back normalised, as written otherwise.
    await page.waitForTimeout(450); // the viewer sends at most one `open` in 400 ms
    await v.locator("#plain").click();
    await expect.poll(() => opens(page, from)).toEqual(["https://example.com/docs?x=1#top", "http://example.org/plain"]);
    await stayedPut(page, from);
    await expect(v.locator("#ext")).toBeVisible();
  });

  test("react: what is not http(s), or lies about where it goes, or is the artifact's own, asks nothing and still goes nowhere", async ({ page }) => {
    await load(page, { type: "react", content: REACT });
    const v = viewer(page);
    const from = await logLength(page);
    for (const id of ["rel", "mail", "js", "cred", "hash"]) {
      await v.locator(`#${id}`).click();
      await page.waitForTimeout(450);
    }
    expect(await opens(page, from)).toEqual([]);
    await stayedPut(page, from);
    // The anchor scrolled (the page is not moved, only scrolled), and the artifact is still there.
    await expect(v.locator("#bottom")).toBeVisible();
  });

  test("react: an artifact that stops the click's propagation cannot let the link through; one that handles the click itself is not asked about", async ({ page }) => {
    await load(page, { type: "react", content: REACT });
    const v = viewer(page);
    const from = await logLength(page);
    await v.locator("#stop").click();
    await expect.poll(() => opens(page, from)).toEqual(["https://example.com/stopped"]);
    await stayedPut(page, from);
    await page.waitForTimeout(450);
    await v.locator("#handled").click();
    await expect(v.locator("#handled")).toHaveText("handled 1");
    await page.waitForTimeout(300);
    expect(await opens(page, from)).toEqual(["https://example.com/stopped"]);
    await stayedPut(page, from);
  });

  test("react: window.open after a click asks; with no click, or with a bad address, it asks nothing; it returns null", async ({ page }) => {
    await load(page, { type: "react", content: REACT });
    const v = viewer(page);
    const from = await logLength(page);
    await v.locator("#bad").click();
    await page.waitForTimeout(450);
    expect(await opens(page, from)).toEqual([]);
    await v.locator("#win").click();
    await expect.poll(() => opens(page, from)).toEqual(["https://example.com/from-window"]);
    await stayedPut(page, from);
    // No person did anything in this document: a script cannot open things by itself. (The click above was in the artifact's document; a new load is a new one.)
    const loaded = await load(page, { type: "react", content: `export default function App() { const r = String(window.open("https://example.com/by-itself")); return <p id="r">{r}</p>; }` }, { id: "no-click" });
    expect(loaded.errors).toEqual([]);
    await expect(viewer(page).locator("#r")).toHaveText("null");
    await page.waitForTimeout(450);
    expect(await opens(page, from)).toEqual(["https://example.com/from-window"]);
  });

  test("a script that calls element.click() on a link, or opens in a loop, asks at most once and only for a real click", async ({ page }) => {
    const content = `import { useEffect } from 'react';
export default function App() {
  useEffect(() => { document.getElementById("auto").click(); }, []);
  return <a id="auto" href="https://example.com/auto">auto</a>;
}`;
    const from = await logLength(page);
    await load(page, { type: "react", content });
    await page.waitForTimeout(500);
    expect(await opens(page, from)).toEqual([]);
    await stayedPut(page, from);
    // Real clicks in a row: one `open` per 400 ms.
    const v = viewer(page);
    await v.locator("#auto").click();
    await v.locator("#auto").click();
    await v.locator("#auto").click();
    await page.waitForTimeout(300);
    expect(await opens(page, from)).toEqual(["https://example.com/auto"]);
  });

  test("select mode: a click selects and does not ask", async ({ page }) => {
    await load(page, { type: "react", content: REACT });
    const v = viewer(page);
    await page.evaluate(() => window.host.selectMode(true));
    const from = await logLength(page);
    await v.locator("#ext").click();
    await expect.poll(() => page.evaluate((f) => window.host.messages("select", f).length, from)).toBe(1);
    await page.waitForTimeout(450);
    expect(await opens(page, from)).toEqual([]);
    await stayedPut(page, from);
  });

  test("html: a click in the artifact's own frame sends `open`, window.open too, and the frame stays put", async ({ page }) => {
    const content = `<a id="ext" href="https://example.com/html">docs</a>
<a id="proto" href="//example.net/proto">proto-relative</a>
<a id="rel" href="local.html">relative</a>
<a id="mail" href="mailto:a@b.example">mail</a>
<button id="win" onclick="window.open('https://example.com/html-window')">open</button>
<form action="https://example.com/post" method="post"><button id="submit">send</button></form>`;
    await load(page, { type: "html", content });
    const d = htmlDoc(page);
    const from = await logLength(page);
    await d.locator("#ext").click();
    await expect.poll(() => opens(page, from)).toEqual(["https://example.com/html"]);
    await page.waitForTimeout(450);
    await d.locator("#proto").click();
    await expect.poll(() => opens(page, from)).toEqual(["https://example.com/html", "https://example.net/proto"]);
    await page.waitForTimeout(450);
    await d.locator("#rel").click();
    await d.locator("#mail").click();
    await d.locator("#submit").click();
    await page.waitForTimeout(450);
    await d.locator("#win").click();
    await expect.poll(() => opens(page, from)).toEqual(["https://example.com/html", "https://example.net/proto", "https://example.com/html-window"]);
    expect(await d.locator("body").evaluate(() => location.href)).toMatch(/^about:srcdoc/);
    await stayedPut(page, from);
  });

  test("markdown: a link asks the app too", async ({ page }) => {
    await load(page, { type: "markdown", content: "See [the docs](https://example.com/md) or [mail](mailto:a@b.example)." });
    const v = viewer(page);
    const from = await logLength(page);
    await v.locator("a[href='mailto:a@b.example']").click();
    await page.waitForTimeout(450);
    expect(await opens(page, from)).toEqual([]);
    await v.locator("a[href='https://example.com/md']").click();
    await expect.poll(() => opens(page, from)).toEqual(["https://example.com/md"]);
    await stayedPut(page, from);
  });

  test("a frame cannot forge an `open` the viewer would not send: bad addresses and hidden frames are dropped", async ({ page }) => {
    const content = `<p id="p">forger</p>
<script>
  var up = function (url) { parent.postMessage({ tz: 1, k: "up", msg: { t: "open", url: url } }, "*"); };
  up("javascript:alert(1)"); up("file:///etc/passwd"); up("https://a@b.example/"); up("ftp://example.com/"); up(" https://example.com/ with space"); up(12); up("https://example.com/" + "x".repeat(3000));
  up("https://example.com/during-load");
</script>`;
    const from = await logLength(page);
    await load(page, { type: "html", content });
    await page.waitForTimeout(600);
    // While the frame is being built it is hidden: nothing it says is passed on, good address or not.
    expect(await opens(page, from)).toEqual([]);
    await expect(htmlDoc(page).locator("#p")).toHaveText("forger");
    // Once visible, a good address from the frame is passed on (the frame is as trusted as an artifact's own click), a bad one never.
    await htmlDoc(page).locator("body").evaluate(() => {
      const up = (url: unknown) => parent.postMessage({ tz: 1, k: "up", msg: { t: "open", url } }, "*");
      up("javascript:alert(1)");
      up("https://a@b.example/");
    });
    await page.waitForTimeout(600);
    expect(await opens(page, from)).toEqual([]);
    await htmlDoc(page).locator("body").evaluate(() => parent.postMessage({ tz: 1, k: "up", msg: { t: "open", url: "https://example.com/ok" } }, "*"));
    await expect.poll(() => opens(page, from)).toEqual(["https://example.com/ok"]);
  });
});
