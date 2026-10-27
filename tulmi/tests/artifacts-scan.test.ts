/**
 * Finding an element's source from its data-tz-id (src/artifacts/scan.ts): nested JSX, self-closing tags, strings that hold `<`, {} expressions
 * with elements and apostrophes in them, fragments, TypeScript generics, and HTML with void elements, raw text and end tags left out.
 */
import { describe, expect, it } from "vitest";
import { contextAround, elementAt, findElementSpan, lineColOf, linesWindow, offsetOf, parseElementId } from "../src/artifacts/scan.js";

/** The text of the element whose opening `<` is the nth occurrence of `needle`, found the way the viewer ids it. */
function spanOf(src: string, type: "react" | "html" | "svg", needle: string, nth = 0): string {
  let at = -1;
  for (let k = 0; k <= nth; k += 1) at = src.indexOf(needle, at + 1);
  expect(at, `${needle} is in the source`).toBeGreaterThanOrEqual(0);
  const lc = lineColOf(src, at);
  const r = findElementSpan(src, type, `${lc.line}:${lc.col}`);
  if (!r.ok) throw new Error(`${needle}: ${r.reason}`);
  return src.slice(r.span.start, r.span.end);
}

const JSX = `import React from "react";
export default function App() {
  const [n, setN] = React.useState<number>(0);
  return (
    <main className="a > b" data-x='it"s'>
      <h1 title="a < b">Hello, {name}!</h1>
      {items.map((i) => <li key={i}>Don't {i < 3 ? "lo" : "hi"}</li>)}
      <Img src="x.png" alt={\`a>\${b}\`} />
      {ok && <b>It's "fine"</b>}
      <>
        <p>frag</p>
      </>
      <Foo.Bar a={{ b: [1, 2, { c: "}" }] }} {...rest}>x</Foo.Bar>
      <button onClick={() => { setN(n + 1); }}>+ {'}'} </button>
      <input disabled />
      {/* <div> in a comment } */}
      {re.test(s) && /<div>[}]/g.test(t) ? <i>ok</i> : null}
    </main>
  );
}`;

describe("an element id", () => {
  it("is line:column, 1-based, and only that", () => {
    expect(parseElementId("14:7")).toEqual({ line: 14, col: 7 });
    expect(parseElementId(" 3:1 ")).toEqual({ line: 3, col: 1 });
    for (const bad of ["", "14", "0:1", "1:0", "a:b", "1:2:3", "14:7;x", 14, null, undefined]) expect(parseElementId(bad), String(bad)).toBeNull();
  });

  it("maps to the index of the `<` and back", () => {
    const src = "ab\ncd\n  <p>x</p>\n";
    const at = offsetOf(src, 3, 3)!;
    expect(src[at]).toBe("<");
    expect(lineColOf(src, at)).toEqual({ line: 3, col: 3 });
    expect(offsetOf(src, 9, 1)).toBeNull();
  });
});

describe("JSX", () => {
  it("reads a nested element whole, whatever strings and expressions are inside it", () => {
    const main = spanOf(JSX, "react", "<main");
    expect(main.startsWith("<main className")).toBe(true);
    expect(main.endsWith("</main>")).toBe(true);
    expect(main).toContain("<input disabled />");
  });

  it("is not fooled by a `<` or `>` in an attribute string", () => {
    expect(spanOf(JSX, "react", "<h1")).toBe('<h1 title="a < b">Hello, {name}!</h1>');
  });

  it("reads an element inside an expression, apostrophes and a less-than included", () => {
    expect(spanOf(JSX, "react", "<li ")).toBe(`<li key={i}>Don't {i < 3 ? "lo" : "hi"}</li>`);
    expect(spanOf(JSX, "react", "<b>")).toBe(`<b>It's "fine"</b>`);
    expect(spanOf(JSX, "react", "<i>")).toBe("<i>ok</i>");
  });

  it("reads a self-closing element with a template string that holds `>`", () => {
    expect(spanOf(JSX, "react", "<Img")).toBe('<Img src="x.png" alt={`a>${b}`} />');
    expect(spanOf(JSX, "react", "<input")).toBe("<input disabled />");
  });

  it("reads a fragment, a member name, a spread and an object with a `}` in a string", () => {
    expect(spanOf(JSX, "react", "<>")).toBe("<>\n        <p>frag</p>\n      </>");
    expect(spanOf(JSX, "react", "<Foo.Bar")).toBe('<Foo.Bar a={{ b: [1, 2, { c: "}" }] }} {...rest}>x</Foo.Bar>');
  });

  it("reads a handler with braces and a text child that is a `}` string", () => {
    expect(spanOf(JSX, "react", "<button")).toBe("<button onClick={() => { setN(n + 1); }}>+ {'}'} </button>");
  });

  it("is not thrown by TypeScript generics, a regex with `<` and `}` in braces, or a comment that holds a tag", () => {
    const src = `const x = useState<Array<string>>([]);\nexport default () => (\n  <ul>\n    {/* <li> } */}\n    {rows.map((r) => <li key={r}>{r}</li>)}\n    {f(<T,>(a: T) => a)}\n  </ul>\n);`;
    expect(spanOf(src, "react", "<ul")).toMatch(/^<ul>[\s\S]*<\/ul>$/);
    expect(spanOf(src, "react", "<li key")).toBe("<li key={r}>{r}</li>");
  });

  it("says why when the element is not well formed, and never guesses", () => {
    const r = findElementSpan("export default () => <div><p>unclosed</div>;", "react", "1:22");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/end could not be found/);
    const none = findElementSpan("const a = 1;\n", "react", "1:3");
    expect(none).toEqual({ ok: false, reason: "No element opens at that place in this version." });
    const far = findElementSpan("const a = 1;\n", "react", "9:1");
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.reason).toMatch(/no line 9/);
  });
});

describe("HTML", () => {
  const HTML = `<!doctype html>
<html><body>
<ul class=list>
  <li>one
  <li>two <b>x</b>
</ul>
<p>para
<div>block</div>
<script>if (a < b) { document.write("<div>") }</script>
<img src="a.png">
<br>
<svg><rect/><g><circle /></g></svg>
<!-- <div> -->
<table><tr><td>1<td>2<tr><td>3</table>
<select><option>a<option>b</select>
<textarea><b>not an element</b></textarea>
<div/>after
</body></html>`;

  it("reads void elements, raw text in script, comments and quoteless attributes", () => {
    expect(spanOf(HTML, "html", "<ul")).toBe("<ul class=list>\n  <li>one\n  <li>two <b>x</b>\n</ul>");
    expect(spanOf(HTML, "html", "<script>")).toBe('<script>if (a < b) { document.write("<div>") }</script>');
    expect(spanOf(HTML, "html", "<img")).toBe('<img src="a.png">');
    expect(spanOf(HTML, "html", "<br>")).toBe("<br>");
    expect(spanOf(HTML, "html", "<textarea>")).toBe("<textarea><b>not an element</b></textarea>");
  });

  it("ends an element whose end tag was left out at the next sibling or at its parent's end tag, and takes no whitespace after it", () => {
    expect(spanOf(HTML, "html", "<li>", 0)).toBe("<li>one");
    expect(spanOf(HTML, "html", "<li>", 1)).toBe("<li>two <b>x</b>");
    expect(spanOf(HTML, "html", "<p>")).toBe("<p>para");
    expect(spanOf(HTML, "html", "<tr>", 0)).toBe("<tr><td>1<td>2");
    expect(spanOf(HTML, "html", "<td>", 1)).toBe("<td>2");
    expect(spanOf(HTML, "html", "<option>", 0)).toBe("<option>a");
  });

  it("honours /> on svg children, and ignores it on a div, as a browser does", () => {
    expect(spanOf(HTML, "html", "<svg>")).toBe("<svg><rect/><g><circle /></g></svg>");
    expect(spanOf(HTML, "html", "<g>")).toBe("<g><circle /></g>");
    expect(spanOf(HTML, "html", "<div/>")).toBe("<div/>after\n</body></html>".slice(0, "<div/>after".length)); // the div stays open until its parent ends
  });

  it("reads an svg artifact's elements with /> everywhere", () => {
    const svg = `<svg viewBox="0 0 10 10"><g id="a"><rect x="1"/><text>1 &lt; 2</text></g></svg>`;
    expect(spanOf(svg, "svg", "<g ")).toBe(`<g id="a"><rect x="1"/><text>1 &lt; 2</text></g>`);
  });
});

describe("what has no elements", () => {
  it("says so for markdown and mermaid", () => {
    for (const t of ["markdown", "mermaid"] as const) {
      const r = findElementSpan("# hi", t, "1:1");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/has no elements/);
    }
    expect(elementAt("x", "markdown", 0).ok).toBe(false);
  });
});

describe("the context around a span", () => {
  const src = "l1\nl2\nl3\nl4\n  <p>x</p> tail\nl6\nl7\nl8\n";

  it("is a few numbered lines before and after, and what shares a line with the span (but not just its indent)", () => {
    const r = findElementSpan(src, "html", "5:3");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = contextAround(src, r.span, { before: 2, after: 2 });
    expect(c.before).toBe("3: l3\n4: l4");
    expect(c.after).toBe("5:  tail\n6: l6");
  });

  it("keeps the words before a span on its line: the `{ok && ` that belongs to the expression around it", () => {
    const code = "a\n{ok && <b>hi</b>}\nz\n";
    const r = findElementSpan(code, "react", "2:8");
    if (!r.ok) throw new Error("no span");
    expect(contextAround(code, r.span)).toEqual({ before: "1: a\n2: {ok && ", after: "2: }\n3: z" });
  });

  it("cuts long lines, and a window of lines is numbered for an error", () => {
    const long = `${"x".repeat(300)}\n<p>a</p>\n`;
    const r = findElementSpan(long, "html", "2:1");
    if (!r.ok) throw new Error("no span");
    expect(contextAround(long, r.span, { width: 40 }).before.length).toBeLessThan(60);
    expect(linesWindow("a\nb\nc\nd\ne", 2, 4)).toBe("2: b\n3: c\n4: d");
    expect(linesWindow("a\nb", -3, 99)).toBe("1: a\n2: b");
  });
});
