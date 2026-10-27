import { expect, test } from "@playwright/test";
import { htmlDoc, load, openHost, viewer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openHost(page);
});

const lineCol = (src: string, needle: string): { line: number; col: number } => {
  const k = src.indexOf(needle);
  const before = src.slice(0, k).split("\n");
  return { line: before.length, col: before[before.length - 1]!.length + 1 };
};

test("a syntax error is an `error` on the line in the artifact's own source", async ({ page }) => {
  const content = `import { useState } from "react";
export default function App() {
  const [n, setN] = useState(0);
  return <div className="a">{n</div>;
}
`;
  const out = await load(page, { type: "react", content });
  expect(out.rendered).toBeUndefined();
  expect(out.errors).toHaveLength(1);
  expect(out.errors[0]).toMatchObject({ t: "error", kind: "compile" });
  expect(out.errors[0]!.line).toBe(4);
  expect(out.errors[0]!.message).not.toMatch(/\(\d+:\d+\)/); // the position is in line/col, not in the text
});

test("the column of a syntax error is in the ORIGINAL text, though element ids were put into the line before it was compiled", async ({ page }) => {
  const content = `export default function App() { return <p><b>one</b><i>two</i></p>; }; const = 4;\n`;
  const out = await load(page, { type: "react", content });
  const e = out.errors[0]!;
  expect(e.kind).toBe("compile");
  expect(e.line).toBe(1);
  // Sucrase blames the `=` that has no name before it.
  expect(e.col).toBe(lineCol(content, "= 4").col);
});

test("an import that is not one of the artifact libraries says which are, at the right line", async ({ page }) => {
  const content = `import { useState } from "react";\nimport confetti from "canvas-confetti";\nexport default () => <p>x</p>;\n`;
  const out = await load(page, { type: "react", content });
  expect(out.errors[0]).toMatchObject({ kind: "import", ...lineCol(content, '"canvas-confetti"') });
  expect(out.errors[0]!.message).toMatch(/canvas-confetti/);
  expect(out.errors[0]!.message).toMatch(/react, react-dom, recharts, lucide-react, d3, three, mermaid/);
});

test("a relative import and an import from a URL are refused with a reason", async ({ page }) => {
  let out = await load(page, { type: "react", content: `import x from "./other";\nexport default () => <p>x</p>;` });
  expect(out.errors[0]).toMatchObject({ kind: "import", line: 1 });
  expect(out.errors[0]!.message).toMatch(/single file/);
  out = await load(page, { type: "react", content: `import x from "https://esm.sh/lodash";\nexport default () => <p>x</p>;` });
  expect(out.errors[0]).toMatchObject({ kind: "import", line: 1 });
  expect(out.errors[0]!.message).toMatch(/network/);
});

test("an export a library does not have is an import error pointing at the name", async ({ page }) => {
  const content = `import { Heart, NotAnIconAtAll } from "lucide-react";\nexport default () => <div><Heart /><NotAnIconAtAll /></div>;\n`;
  const out = await load(page, { type: "react", content });
  expect(out.errors[0]).toMatchObject({ kind: "import", line: 1 });
  expect(out.errors[0]!.col).toBe(lineCol(content, "NotAnIconAtAll").col);
  expect(out.errors[0]!.message).toMatch(/lucide-react.*NotAnIconAtAll/);
});

test("a component that throws while it renders: runtime error at its line, and an error box instead of a blank page", async ({ page }) => {
  const content = `export default function App() {
  const items: any = null;
  return <ul>{items.map((i: number) => <li key={i}>{i}</li>)}</ul>;
}
`;
  const out = await load(page, { type: "react", content });
  const e = out.errors.find((x) => /map/.test(x.message));
  expect(e).toBeTruthy();
  expect(e!.kind).toBe("runtime");
  expect(e!.line).toBe(3);
  expect(e!.col).toBeGreaterThan(0);
  await expect(viewer(page).locator(".tz-err")).toContainText("map");
});

test("a component that renders something React cannot (an undefined component) says so", async ({ page }) => {
  const content = `import * as Icons from "lucide-react";\nconst Missing = (Icons as any).NoSuchIcon;\nexport default () => <div><Missing /></div>;\n`;
  const out = await load(page, { type: "react", content });
  const e = out.errors.find((x) => /Element type is invalid/.test(x.message));
  expect(e?.kind).toBe("runtime");
});

test("an error in an event handler (window.onerror) and an unhandled promise rejection are caught, with lines", async ({ page }) => {
  const content = `import { useEffect } from "react";
export default function App() {
  useEffect(() => { Promise.reject(new Error("async failure")); }, []);
  return (
    <button id="b" onClick={() => {
      throw new Error("handler failure");
    }}>go</button>
  );
}
`;
  const out = await load(page, { type: "react", content });
  const rejection = await page.evaluate(() => window.host.waitFor((m) => m.t === "error" && /async failure/.test(m.message)));
  expect(rejection.kind).toBe("runtime");
  expect(rejection.line).toBe(3);
  expect(out.rendered).toBeTruthy();
  await viewer(page).locator("#b").click();
  const e = await page.evaluate(() => window.host.waitFor((m) => m.t === "error" && /handler failure/.test(m.message)));
  expect(e.kind).toBe("runtime");
  expect(e.line).toBe(6);
  expect(e.stack).toMatch(/handler failure/);
});

test("an error thrown at the top level of the artifact is a runtime error", async ({ page }) => {
  const out = await load(page, { type: "react", content: `const data = JSON.parse("{not json");\nexport default () => <p>{String(data)}</p>;\n` });
  expect(out.errors.some((e) => e.kind === "runtime" && /JSON/.test(e.message))).toBe(true);
});

test("a missing default export is explained", async ({ page }) => {
  const out = await load(page, { type: "react", content: `export const App = () => <p>x</p>;\n` });
  expect(out.errors[0]).toMatchObject({ kind: "runtime" });
  expect(out.errors[0]!.message).toMatch(/default export/);
});

test("html: a syntax error inside a script is a runtime error at its line; JSX in html is explained", async ({ page }) => {
  const out = await load(page, { type: "html", content: `<p>x</p>\n<script>\nvar a = ;\n</script>` });
  expect(out.errors.length).toBeGreaterThan(0);
  const bad = await load(page, { type: "html", content: `<div id="root"></div>\n<script type="text/babel">\nconst A = () => <p/>;\n</script>` }, { id: "b" });
  expect(bad.errors[0]).toMatchObject({ kind: "compile", line: 2 });
  expect(bad.errors[0]!.message).toMatch(/react/);
});

test("html: an error in a nested handler and in setTimeout is reported with a line", async ({ page }) => {
  const content = `<div>\n<script>\nsetTimeout(function () {\n  missingFunction();\n}, 10);\n</script>\n</div>`;
  await load(page, { type: "html", content: content.replace("<div>", "<div>text") });
  const e = await page.evaluate(() => window.host.waitFor((m) => m.t === "error" && /missingFunction/.test(m.message)));
  expect(e.kind).toBe("runtime");
  expect(e.line).toBe(4);
  await expect(htmlDoc(page).locator("div")).toBeVisible();
});

test("svg and markdown never raise errors for odd input; an empty artifact renders", async ({ page }) => {
  for (const [type, content] of [["svg", "not svg at all <<<"], ["markdown", "\u0000\u0001 ```"], ["svg", ""], ["markdown", ""]] as const) {
    const out = await load(page, { type, content }, { id: type + content.length });
    expect(out.errors).toEqual([]);
    expect(out.rendered).toBeTruthy();
  }
});

test("a syntax error Sucrase lets through (a name declared twice) is a compile error, with the line from the browser", async ({ page }) => {
  const content = `export default function App() {\n  const a = 1;\n  const a = 2;\n  return <p>{a}</p>;\n}\n`;
  const out = await load(page, { type: "react", content });
  expect(out.errors).toHaveLength(1);
  expect(out.errors[0]).toMatchObject({ kind: "compile", line: 3 });
  expect(out.errors[0]!.message).toMatch(/already been declared/);
});
