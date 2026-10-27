import { expect, test } from "@playwright/test";
import { htmlDoc, load, openHost, viewer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openHost(page);
});

test("html: markup, inline <script> and an inline onclick run under the strict CSP, with ids", async ({ page }) => {
  const content = `<!doctype html>
<html><head><style>.big{font-size:30px}</style></head>
<body>
  <h1 class="big" id="title">Hello</h1>
  <button id="b" onclick="document.getElementById('out').textContent = 'clicked ' + this.id">Go</button>
  <p id="out">waiting</p>
  <script>
    document.getElementById('title').textContent = 'Hello from script';
    window.addEventListener('load', function () { document.body.dataset.loaded = '1'; });
    document.addEventListener('DOMContentLoaded', function () { document.body.dataset.dcl = '1'; });
  </script>
</body></html>`;
  const out = await load(page, { type: "html", content });
  expect(out.errors).toEqual([]);
  expect(out.rendered?.version).toBe(1);
  const doc = htmlDoc(page);
  await expect(doc.locator("#title")).toHaveText("Hello from script");
  await expect(doc.locator("body")).toHaveAttribute("data-dcl", "1");
  await expect(doc.locator("body")).toHaveAttribute("data-loaded", "1");
  await doc.locator("#b").click();
  await expect(doc.locator("#out")).toHaveText("clicked b");
  // ids: the position of each element's < in the original text
  await expect(doc.locator("#title")).toHaveAttribute("data-tz-id", "4:3");
  await expect(doc.locator("#b")).toHaveAttribute("data-tz-id", "5:3");
});

test("html: a script error is reported with the line in the artifact's own source", async ({ page }) => {
  const content = `<p>hi</p>\n<script>\n  var a = 1;\n  throw new Error("boom in script");\n</script>`;
  const out = await load(page, { type: "html", content });
  const e = out.errors.find((x) => /boom in script/.test(x.message));
  expect(e?.kind).toBe("runtime");
  expect(e?.line).toBe(4);
});

test("html: a handler that throws is reported at its line, and an unbundled CDN script is refused with a reason", async ({ page }) => {
  const content = `<button id="x" onclick="nope.nothing()">x</button>\n<script src="https://cdn.example.com/lib.js"></script>`;
  const out = await load(page, { type: "html", content });
  const blocked = out.errors.find((e) => /Blocked <script src="https:\/\/cdn.example.com\/lib.js"/.test(e.message));
  expect(blocked?.kind).toBe("import");
  expect(blocked?.line).toBe(2);
  await htmlDoc(page).locator("#x").click();
  await expect.poll(() => page.evaluate(() => window.host.messages("error").find((e: any) => /nope is not defined/.test(e.message))?.line)).toBe(1);
});

test("html: a module script can import the bundled libraries by name, and the d3 CDN script becomes the bundled d3", async ({ page }) => {
  const content = `<div id="out"></div>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script type="module">
  import { scaleLinear } from "d3";
  const s = scaleLinear().domain([0, 10]).range([0, 100]);
  document.getElementById("out").textContent = "module:" + s(5) + " global:" + window.d3.scaleLinear().domain([0, 4]).range([0, 8])(2);
</script>`;
  const out = await load(page, { type: "html", content });
  expect(out.errors).toEqual([]);
  await expect(htmlDoc(page).locator("#out")).toHaveText("module:50 global:4");
});

test("svg: renders sanitised, without script or handlers", async ({ page }) => {
  const content = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=1">
  <script>window.__pwned = 1</script>
  <circle id="c" cx="50" cy="50" r="40" fill="tomato" onclick="window.__pwned=1"/>
  <image href="https://evil.example/x.png"/>
</svg>`;
  const out = await load(page, { type: "svg", content });
  expect(out.errors).toEqual([]);
  const v = viewer(page);
  await expect(v.locator("svg circle#c")).toHaveAttribute("fill", "tomato");
  await expect(v.locator("svg circle#c")).toHaveAttribute("data-tz-id", "3:3");
  expect(await v.locator("svg").evaluate((s) => s.outerHTML)).not.toMatch(/script|onload|onclick|evil/);
  await v.locator("svg circle#c").click();
  expect(await page.evaluate(() => (document.getElementById("frame") as HTMLIFrameElement).contentWindow && true)).toBe(true);
});

test("markdown: headings, lists, code, tables and safe links render; raw HTML does not", async ({ page }) => {
  const content = "# Title\n\nSome **bold** text with a [link](https://example.com) and <b onmouseover=alert(1)>raw</b>.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n![pic](data:image/png;base64,iVBORw0KGgo=)\n";
  const out = await load(page, { type: "markdown", content });
  expect(out.errors).toEqual([]);
  const v = viewer(page);
  await expect(v.locator("h1#title")).toHaveText("Title");
  await expect(v.locator("strong")).toHaveText("bold");
  await expect(v.locator("a[href='https://example.com']")).toHaveAttribute("rel", /noopener/);
  await expect(v.locator("table td").first()).toHaveText("1");
  await expect(v.locator("pre code")).toHaveText("const x = 1;");
  await expect(v.locator("img[alt=pic]")).toHaveAttribute("src", /^data:image\/png/);
  await expect(v.locator("article b")).toHaveCount(0);
  await expect(v.locator("article")).toContainText("<b onmouseover=alert(1)>raw</b>");
});

test("mermaid: the library is imported on first use and the diagram is drawn", async ({ page }) => {
  const out = await load(page, { type: "mermaid", content: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Done]\n  B -->|no| A" });
  expect(out.errors).toEqual([]);
  const v = viewer(page);
  await expect(v.locator(".tz-mermaid svg")).toBeVisible();
  await expect(v.locator(".tz-mermaid svg")).toContainText("Choice");
});

test("mermaid: a diagram that does not parse is an error on the line mermaid names", async ({ page }) => {
  const out = await load(page, { type: "mermaid", content: "graph TD\n  A --> B\n  this is not valid ---> [[[" });
  expect(out.errors.length).toBeGreaterThan(0);
  expect(out.errors[0]!.kind).toBe("compile");
  expect(out.errors[0]!.line).toBe(3);
});

test("react: a component with state renders, updates, and every element carries its source position", async ({ page }) => {
  const content = `import { useState } from "react";

export default function App() {
  const [n, setN] = useState(0);
  return (
    <div className="card" id="app">
      <h1>Counter</h1>
      <button id="inc" onClick={() => setN(n + 1)}>Clicked {n}</button>
    </div>
  );
}
`;
  const out = await load(page, { type: "react", content });
  expect(out.errors).toEqual([]);
  expect(out.rendered).toBeTruthy();
  const v = viewer(page);
  await expect(v.locator("#inc")).toHaveText("Clicked 0");
  await v.locator("#inc").click();
  await expect(v.locator("#inc")).toHaveText("Clicked 1");
  await expect(v.locator("#app")).toHaveAttribute("data-tz-id", "6:5");
  await expect(v.locator("h1")).toHaveAttribute("data-tz-id", "7:7");
  await expect(v.locator("#inc")).toHaveAttribute("data-tz-id", "8:7");
});

test("react: recharts and lucide-react render (and share the one React)", async ({ page }) => {
  const content = `import React, { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Heart, Activity } from "lucide-react";

const data = [{ name: "Mon", v: 3 }, { name: "Tue", v: 7 }, { name: "Wed", v: 5 }];

export default function App() {
  const [liked, setLiked] = useState(false);
  return (
    <div style={{ width: 420 }}>
      <button id="like" onClick={() => setLiked(!liked)}>
        <Heart size={18} fill={liked ? "red" : "none"} /> {liked ? "liked" : "like"} <Activity size={14} />
      </button>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="v" stroke="#8884d8" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
`;
  const out = await load(page, { type: "react", content });
  expect(out.errors).toEqual([]);
  const v = viewer(page);
  await expect(v.locator(".recharts-wrapper svg.recharts-surface")).toBeVisible();
  await expect(v.locator(".recharts-line-curve")).toHaveCount(1);
  await expect(v.locator("svg.lucide-heart")).toBeVisible();
  await v.locator("#like").click(); // hooks work across the library boundary: one React
  await expect(v.locator("#like")).toContainText("liked");
});

test("react: d3 and three are imported only when the artifact imports them", async ({ page }) => {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(new URL(r.url()).pathname));
  const content = `import { scaleLinear } from "d3";
import { Vector3 } from "three";
export default function App() {
  const s = scaleLinear().domain([0, 1]).range([0, 10]);
  const v = new Vector3(1, 2, 3).length().toFixed(3);
  return <p id="r">{s(0.5)} {v}</p>;
}`;
  const out = await load(page, { type: "react", content });
  expect(out.errors).toEqual([]);
  await expect(viewer(page).locator("#r")).toHaveText("5 3.742");
  expect(seen.some((p) => /\/vendor\/d3@/.test(p))).toBe(true);
  expect(seen.some((p) => /\/vendor\/three@/.test(p))).toBe(true);
  expect(seen.some((p) => /\/vendor\/(recharts|lucide-react|mermaid)/.test(p))).toBe(false);
});

test("react: a viewer opened as /?type=react preloads what the type needs, and works the same", async ({ page }) => {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(new URL(r.url()).pathname));
  await page.evaluate(() => window.host.reset("react"));
  await page.waitForFunction(() => window.host.log.filter((e) => e.msg.t === "ready").length >= 2);
  const out = await load(page, { type: "react", content: `import { useState } from "react"; export default () => { const [n] = useState(41); return <p id="r">{n + 1}</p>; };` });
  expect(out.errors).toEqual([]);
  await expect(viewer(page).locator("#r")).toHaveText("42");
  // Each file once: the preload and the real import share one fetch.
  const counts = new Map<string, number>();
  for (const p of seen) counts.set(p, (counts.get(p) ?? 0) + 1);
  for (const name of ["sucrase@", "react-dom@", "compile."]) {
    const hits = [...counts].filter(([p]) => p.includes(name));
    expect(hits.length, name).toBe(1);
    expect(hits[0]![1], name).toBe(1);
  }
});

test("react: every library of protocol.ts's ARTIFACT_LIBS can be imported, and they share one React", async ({ page }) => {
  const content = `import React, { useState, useId } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { jsx } from "react/jsx-runtime";
import { BarChart, Bar } from "recharts";
import { Star } from "lucide-react";
import * as d3 from "d3";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import mermaid from "mermaid";

export default function App() {
  const [ready, setReady] = useState("pending");
  const id = useId();
  React.useEffect(() => {
    (async () => {
      mermaid.initialize({ startOnLoad: false });
      const { svg } = await mermaid.render("m" + id.replace(/:/g, ""), "graph LR; A-->B");
      setReady([
        typeof createPortal, typeof flushSync, typeof createRoot, typeof jsx, typeof BarChart, typeof Bar, typeof Star,
        d3.sum([1, 2, 3]), JSON.stringify(d3.csvParse("a,b\\n1,2")[0]).replace(/,/g, ";"), new THREE.Vector3(3, 4, 0).length(), typeof OrbitControls, svg.includes("<svg"),
        React.version, typeof (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
      ].join(","));
    })().catch((e) => setReady("failed:" + e.message));
  }, []);
  return <p id="r">{ready}</p>;
}
`;
  const out = await load(page, { type: "react", content });
  expect(out.errors).toEqual([]);
  await expect(viewer(page).locator("#r")).toHaveText('function,function,function,function,object,function,object,6,{"a":"1";"b":"2"},5,function,true,18.3.1,object');
});
