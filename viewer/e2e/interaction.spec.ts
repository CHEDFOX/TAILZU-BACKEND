import { expect, test } from "@playwright/test";
import { htmlDoc, load, logLength, openHost, selected, viewer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openHost(page);
});

const at = (src: string, needle: string): string => {
  const k = src.indexOf(needle);
  expect(k).toBeGreaterThanOrEqual(0);
  const before = src.slice(0, k).split("\n");
  return `${before.length}:${before[before.length - 1]!.length + 1}`;
};

const NESTED = `export default function App() {
  return (
    <main>
      <ul className="list">
        <li>
          <span id="deep">Deep text that is nested</span> and more words
        </li>
      </ul>
      <button id="btn" onClick={() => { (window as any).__clicked = ((window as any).__clicked || 0) + 1; }}>Click me</button>
    </main>
  );
}
`;

test.describe("select mode (point and change)", () => {
  test("react: a click on a nested element sends its source position, tag, text and rect, and does nothing else", async ({ page }) => {
    await load(page, { type: "react", content: NESTED });
    const v = viewer(page);
    await page.evaluate(() => window.host.selectMode(true));
    const from = await logLength(page);
    await v.locator("#deep").click();
    const sel = await page.evaluate((f) => window.host.waitFor((m) => m.t === "select", { from: f }), from);
    expect(sel.elementId).toBe(at(NESTED, "<span"));
    expect(sel.elementId).toBe("6:11");
    expect(sel.tag).toBe("span");
    expect(sel.text).toBe("Deep text that is nested");
    expect(sel.rect.w).toBeGreaterThan(50);
    expect(sel.rect.h).toBeGreaterThan(5);
    // The element above it, and the button (whose click handler must not run):
    const li = await selected(page, () => v.locator("li").click({ position: { x: 400, y: 4 } })); // the right of the line, where only the <li> is
    expect(li.elementId).toBe(at(NESTED, "<li>"));
    const btn = await selected(page, () => v.locator("#btn").click());
    expect(btn.elementId).toBe(at(NESTED, "<button"));
    expect(btn.tag).toBe("button");
    expect(await v.locator("body").evaluate(() => (window as any).__clicked)).toBeUndefined();
    // Off again: the click is the artifact's.
    await page.evaluate(() => window.host.selectMode(false));
    await v.locator("#btn").click();
    await expect.poll(() => v.locator("body").evaluate(() => (window as any).__clicked)).toBe(1);
  });

  test("hovering outlines the element under the pointer, and only in select mode", async ({ page }) => {
    await load(page, { type: "react", content: NESTED });
    const v = viewer(page);
    await v.locator("#deep").hover();
    await expect(v.locator("#tz-overlay")).toHaveCount(0);
    await page.evaluate(() => window.host.selectMode(true));
    await v.locator("#deep").hover();
    const overlay = v.locator("#tz-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute("data-tag", "span");
    const box = await v.locator("#deep").boundingBox();
    const ob = await overlay.boundingBox();
    expect(Math.abs(ob!.x - box!.x)).toBeLessThan(3);
    expect(Math.abs(ob!.width - box!.width)).toBeLessThan(5);
    await page.evaluate(() => window.host.selectMode(false));
    await expect(overlay).toBeHidden();
  });

  test("html: the same, in the artifact's own frame", async ({ page }) => {
    const content = `<div class="a">\n  <p>Hello <b id="bold">bold</b> world</p>\n  <button id="go" onclick="window.__n = (window.__n || 0) + 1">Go</button>\n</div>`;
    await load(page, { type: "html", content });
    const d = htmlDoc(page);
    await page.evaluate(() => window.host.selectMode(true));
    const from = await logLength(page);
    await d.locator("#bold").click();
    const sel = await page.evaluate((f) => window.host.waitFor((m) => m.t === "select", { from: f }), from);
    expect(sel.elementId).toBe(at(content, "<b "));
    expect(sel.elementId).toBe("2:12");
    expect(sel.tag).toBe("b");
    expect(sel.text).toBe("bold");
    await d.locator("#go").click();
    expect(await d.locator("body").evaluate(() => (window as any).__n)).toBeUndefined();
    await d.locator("#bold").hover();
    await expect(d.locator("#tz-overlay")).toBeVisible();
    await page.evaluate(() => window.host.selectMode(false));
    await d.locator("#go").click();
    await expect.poll(() => d.locator("body").evaluate(() => (window as any).__n)).toBe(1);
  });

  test("svg: elements are selectable by their position in the svg source", async ({ page }) => {
    const content = `<svg viewBox="0 0 100 100">\n  <g>\n    <circle id="c" cx="50" cy="50" r="30"/>\n  </g>\n</svg>`;
    await load(page, { type: "svg", content });
    await page.evaluate(() => window.host.selectMode(true));
    const from = await logLength(page);
    await viewer(page).locator("#c").click();
    const sel = await page.evaluate((f) => window.host.waitFor((m) => m.t === "select", { from: f }), from);
    expect(sel.elementId).toBe("3:5");
    expect(sel.tag).toBe("circle");
  });
});

test.describe("streaming", () => {
  test("react: re-renders only when the source compiles, and the last good render never leaves the screen", async ({ page }) => {
    const v1 = `export default function App() { return <div id="t">Version one</div>; }\n`;
    const v2 = `export default function App() {\n  return (\n    <div id="t">\n      Version two\n    </div>\n  );\n}\n`;
    await load(page, { type: "react", content: v1 });
    await expect(v.call(null, page).locator("#t")).toHaveText("Version one");

    // Watch #root: it must never be empty from here on.
    await viewer(page).locator("body").evaluate(() => {
      (window as any).__empty = 0;
      (window as any).__texts = new Set<string>();
      const root = document.getElementById("root")!;
      new MutationObserver(() => {
        if (!root.firstChild) (window as any).__empty++;
        (window as any).__texts.add(root.textContent);
      }).observe(root, { childList: true, subtree: true, characterData: true });
    });

    const from = await logLength(page);
    // The source arrives in pieces; most prefixes do not compile.
    for (let cut = 20; cut < v2.length; cut += 9) {
      await page.evaluate((c) => window.host.stream(c, false), v2.slice(0, cut));
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(500);
    expect(await page.evaluate((f) => window.host.messages("error", f), from)).toEqual([]); // half-written source is not an error
    await expect(viewer(page).locator("#t")).toHaveText(/Version (one|two)/);
    await page.evaluate((c) => window.host.stream(c, true), v2);
    await page.evaluate((f) => window.host.waitFor((m) => m.t === "rendered", { from: f }), from);
    await expect(viewer(page).locator("#t")).toHaveText("Version two");
    expect(await viewer(page).locator("body").evaluate(() => (window as any).__empty)).toBe(0);
  });

  test("react: a finished source that fails to compile is reported, and the last good render is still there", async ({ page }) => {
    await load(page, { type: "react", content: `export default () => <p id="t">good</p>;` });
    const from = await logLength(page);
    await page.evaluate(() => window.host.stream(`export default () => <p id="t">bad</p`, true));
    const err = await page.evaluate((f) => window.host.waitFor((m) => m.t === "error", { from: f }), from);
    expect(err.kind).toBe("compile");
    await expect(viewer(page).locator("#t")).toHaveText("good");
  });

  test("react: a streamed version that throws while rendering falls back to the last good one, silently, until it is final", async ({ page }) => {
    await load(page, { type: "react", content: `export default () => <p id="t">good</p>;` });
    const from = await logLength(page);
    const bad = `export default function App() { const x: any = undefined; return <p id="t">{x.nope}</p>; }`;
    await page.evaluate((b) => window.host.stream(b, false), bad);
    await page.waitForTimeout(600);
    await expect(viewer(page).locator("#t")).toHaveText("good");
    expect(await page.evaluate((f) => window.host.messages("error", f), from)).toEqual([]);
    await page.evaluate((b) => window.host.stream(b, true), bad);
    const err = await page.evaluate((f) => window.host.waitFor((m) => m.t === "error", { from: f }), from);
    expect(err.kind).toBe("runtime");
    expect(err.message).toMatch(/nope|undefined/);
  });

  test("renders are debounced: a burst of stream messages makes a few renders, not one each", async ({ page }) => {
    await load(page, { type: "markdown", content: "" });
    const from = await logLength(page);
    const text = "word ".repeat(300);
    await page.evaluate(async (t) => {
      for (let i = 1; i <= 60; i++) {
        window.host.stream(t.slice(0, i * 25), false);
        await new Promise((r) => setTimeout(r, 10));
      }
    }, text);
    await page.waitForTimeout(700);
    const rendered = await page.evaluate((f) => window.host.messages("rendered", f).length, from);
    expect(rendered).toBeGreaterThanOrEqual(2);
    expect(rendered).toBeLessThan(15); // 60 messages over ~700 ms at 150 ms: a handful
  });

  test("markdown: grows in place, an open code fence is shown as code, the DOM nodes that did not change are the same nodes", async ({ page }) => {
    await load(page, { type: "markdown", content: "" });
    const v = viewer(page);
    await page.evaluate(() => window.host.stream("# Title\n\nFirst paragraph.\n\n```js\nconst a", false));
    await expect(v.locator("pre code")).toHaveText("const a");
    await v.locator("h1").evaluate((h) => ((h as any).__same = true));
    await page.evaluate(() => window.host.stream("# Title\n\nFirst paragraph.\n\n```js\nconst a = 1;\n```\n\nSecond.", false));
    await expect(v.locator("pre code")).toHaveText("const a = 1;");
    await expect(v.locator("p").last()).toHaveText("Second.");
    expect(await v.locator("h1").evaluate((h) => (h as any).__same)).toBe(true);
    await page.evaluate(() => window.host.stream("# Title\n\nFirst paragraph.\n\n```js\nconst a = 1;\n```\n\nSecond.", true));
    await page.evaluate(() => window.host.waitFor((m) => m.t === "rendered", { from: 0 }));
  });

  test("html: the markup so far is shown while it streams, then the finished page runs its scripts", async ({ page }) => {
    await load(page, { type: "html", content: "" });
    const d = htmlDoc(page);
    await page.evaluate(() => window.host.stream(`<h1 id="h">Streaming…</h1><p id="p">first par`, false));
    await expect(d.locator("#h")).toHaveText("Streaming…");
    await d.locator("#h").evaluate((h) => ((h as any).__same = true));
    await page.evaluate(() => window.host.stream(`<h1 id="h">Streaming…</h1><p id="p">first paragraph</p><button id="b" onclick="this.textContent='ran'">btn</button><script>document.getElementById("h").textContent = "Done"</script>`, false));
    await expect(d.locator("#p")).toHaveText("first paragraph");
    // Nothing runs while streaming, and an unchanged node is the same node.
    await expect(d.locator("#h")).toHaveText("Streaming…");
    expect(await d.locator("#h").evaluate((h) => (h as any).__same)).toBe(true);
    await d.locator("#b").click();
    await expect(d.locator("#b")).toHaveText("btn");
    const from = await logLength(page);
    await page.evaluate(() => window.host.stream(`<h1 id="h">Streaming…</h1><p id="p">first paragraph</p><button id="b" onclick="this.textContent='ran'">btn</button><script>document.getElementById("h").textContent = "Done"</script>`, true));
    await page.evaluate((f) => window.host.waitFor((m) => m.t === "rendered", { from: f }), from);
    await expect(d.locator("#h")).toHaveText("Done");
    await d.locator("#b").click();
    await expect(d.locator("#b")).toHaveText("ran");
  });
});

// (kept short so the streaming tests read cleanly)
const v = viewer;

test.describe("resize", () => {
  test("the viewer reports its content height as it changes, from a ResizeObserver", async ({ page }) => {
    const content = `import { useState } from "react";
export default function App() {
  const [rows, setRows] = useState(3);
  return (
    <div>
      <button id="more" onClick={() => setRows(rows + 5)}>more</button>
      <button id="less" onClick={() => setRows(1)}>less</button>
      {Array.from({ length: rows }, (_, i) => <div key={i} style={{ height: 40 }}>row {i}</div>)}
    </div>
  );
}
`;
    const from = await logLength(page);
    await load(page, { type: "react", content });
    const first = await page.evaluate((f) => window.host.waitFor((m) => m.t === "resize", { from: f }), from);
    expect(first.height).toBeGreaterThanOrEqual(3 * 40);
    expect(first.height).toBeLessThan(3 * 40 + 60);
    const mark = await logLength(page);
    await viewer(page).locator("#more").click();
    const grown = await page.evaluate((f) => window.host.waitFor((m) => m.t === "resize" && m.height > 0, { from: f }), mark);
    expect(grown.height).toBeGreaterThanOrEqual(8 * 40);
    // The host sizes its iframe from it, as the app would.
    await expect.poll(() => page.evaluate(() => parseInt((document.getElementById("frame") as HTMLElement).style.height))).toBeGreaterThanOrEqual(8 * 40);
    const mark2 = await logLength(page);
    await viewer(page).locator("#less").click();
    const shrunk = await page.evaluate((f) => window.host.waitFor((m) => m.t === "resize", { from: f }), mark2);
    expect(shrunk.height).toBeLessThan(grown.height);
    expect(shrunk.height).toBeLessThan(120);
  });

  test("html: the frame's content height is reported too", async ({ page }) => {
    const from = await logLength(page);
    await load(page, { type: "html", content: `<div style="height:333px;background:#eee">tall</div>` });
    const m = await page.evaluate((f) => window.host.waitFor((x) => x.t === "resize" && x.height > 300, { from: f }), from);
    expect(m.height).toBeGreaterThanOrEqual(333);
    expect(m.height).toBeLessThan(360);
  });
});

test.describe("every kind streams", () => {
  test("svg grows as it is written; a half-written drawing is shown as far as it goes", async ({ page }) => {
    await load(page, { type: "svg", content: "" });
    const v = viewer(page);
    await page.evaluate(() => window.host.stream(`<svg viewBox="0 0 10 10"><rect id="r" width="4" height="4"/><circle id="c" cx="`, false));
    await expect(v.locator("svg rect#r")).toBeVisible();
    await expect(v.locator("svg circle")).toHaveCount(0);
    await page.evaluate(() => window.host.stream(`<svg viewBox="0 0 10 10"><rect id="r" width="4" height="4"/><circle id="c" cx="5" cy="5" r="2"/></svg>`, true));
    await expect(v.locator("svg circle#c")).toBeVisible();
  });

  test("mermaid: the diagram appears when it first parses, and a later invalid tick keeps it", async ({ page }) => {
    await load(page, { type: "mermaid", content: "" });
    const v = viewer(page);
    const from = await logLength(page);
    await page.evaluate(() => window.host.stream("graph TD\n  A-->B", false));
    await expect(v.locator(".tz-mermaid svg")).toContainText("B");
    await page.evaluate(() => window.host.stream("graph TD\n  A-->B\n  B-->[[", false));
    await page.waitForTimeout(500);
    await expect(v.locator(".tz-mermaid svg")).toContainText("B");
    expect(await page.evaluate((f) => window.host.messages("error", f), from)).toEqual([]);
    await page.evaluate(() => window.host.stream("graph TD\n  A-->B\n  B-->C", true));
    await expect(v.locator(".tz-mermaid svg")).toContainText("C");
  });

  test("an empty `load` opens the page without an error, whatever the type", async ({ page }) => {
    for (const type of ["react", "html", "svg", "markdown", "mermaid"]) {
      const out = await load(page, { type, content: "" }, { id: "empty-" + type });
      expect(out.errors, type).toEqual([]);
      expect(out.rendered, type).toBeTruthy();
    }
  });
});
