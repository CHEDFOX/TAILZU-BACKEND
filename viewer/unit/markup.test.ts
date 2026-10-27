import { describe, expect, it } from "vitest";
import { prepareHtml, sanitizeCss, sanitizeSvg, tokenize } from "../lib/markup.js";
import { lineColAt, lineStarts } from "../lib/text.js";

const idsOf = (html: string): string[] => [...html.matchAll(/data-tz-id="(\d+:\d+)"/g)].map((m) => m[1]!);
/** "line:col" of the first occurrence of `needle`. */
const at = (src: string, needle: string): string => {
  const k = src.indexOf(needle);
  expect(k).toBeGreaterThanOrEqual(0);
  const { line, col } = lineColAt(lineStarts(src), k);
  return `${line}:${col}`;
};

describe("prepareHtml: element ids", () => {
  it("puts the position of each visible element's < in the original text", () => {
    const src = `<!doctype html>\n<html><head><title>t</title><style>p{color:red}</style></head>\n<body class="a">\n  <div id="x"><p>one</p><br/><img src="a.png"></div>\n</body></html>`;
    const r = prepareHtml(src);
    expect(r.html).toContain(`<body data-tz-id="${at(src, "<body")}" class="a">`);
    expect(r.html).toContain(`<div data-tz-id="${at(src, "<div")}" id="x">`);
    expect(r.html).toContain(`<p data-tz-id="${at(src, "<p>one")}">one</p>`);
    expect(r.html).toContain(`<br data-tz-id="${at(src, "<br")}"/>`);
    expect(r.html).toContain(`<img data-tz-id="${at(src, "<img")}" src="a.png">`);
    expect(at(src, "<div")).toBe("4:3");
    // html, head, title and style are not things to point at.
    expect(r.html).toContain(`<html><head><title>t</title><style>p{color:red}</style></head>`);
    expect(r.ids).toBe(5);
  });

  it("is not fooled by comments, strings that hold <, or text that is not a tag", () => {
    const src = `<!-- <div> --><p title="<b> & >">1 < 2 and 3<4</p><textarea><i>raw</i></textarea><p>after</p>`;
    const r = prepareHtml(src);
    expect(idsOf(r.html)).toEqual([at(src, '<p title'), at(src, "<textarea"), at(src, "<p>after")]);
    expect(r.html).toContain("<!-- <div> -->");
    expect(r.html).toContain("<i>raw</i></textarea>");
    expect(r.html).toContain("1 < 2 and 3<4</p>");
  });

  it("counts lines and columns in the original text, \\r\\n included", () => {
    const r = prepareHtml("<div>\r\n  <span>x</span>\r\n</div>");
    expect(idsOf(r.html)).toEqual(["1:1", "2:3"]);
  });

  it("leaves a half-written tag out while streaming, and everything before it", () => {
    const r = prepareHtml(`<div><p>hello</p><span class="a`, { streaming: true });
    expect(r.html).toBe(`<div data-tz-id="1:1"><p data-tz-id="1:6">hello</p>`);
    expect(prepareHtml(`<div><script>let a = 1`).html).toBe(`<div data-tz-id="1:1">`);
  });
});

describe("prepareHtml: scripts and handlers", () => {
  const page = `<body>\n<button onclick="go(&quot;a&quot;)" id=b>Go</button>\n<script>\n  let n = 1;\n  function go(x) { n++; }\n</script>\n<script type="module">import * as d3 from "d3";</script>\n<script src="https://cdn.example/x.js"></script>\n<script type="application/json" id="d">{"a":1}</script>\n</body>`;

  it("takes scripts out in order, with their position, and leaves a placeholder", () => {
    const r = prepareHtml(page);
    expect(r.scripts.map((s) => [s.index, s.kind, s.src])).toEqual([[0, "classic", null], [1, "module", null], [2, "classic", "https://cdn.example/x.js"]]);
    expect(r.scripts[0]).toMatchObject({ line: 3, col: 9 });
    expect(r.scripts[0]!.code).toContain("function go(x)");
    expect(r.html).toContain(`<template data-tz-s="0"></template>`);
    expect(r.html).toContain(`<template data-tz-s="2"></template>`);
    expect(r.html).not.toContain("function go");
    // A JSON data block is not code: it stays where it is.
    expect(r.html).toContain(`<script type="application/json" id="d">{"a":1}</script>`);
  });

  it("takes on… attributes out, decoded, and marks the element", () => {
    const r = prepareHtml(page);
    expect(r.handlers).toEqual([{ index: 0, event: "click", code: 'go("a")', line: 2, col: 18 }]);
    expect(page.split("\n")[1]!.indexOf("go(&quot;")).toBe(17);
    expect(r.html).toContain(`<button data-tz-id="2:1" data-tz-h="0" id=b>Go</button>`);
    expect(r.html).not.toContain("onclick");
  });

  it("runs nothing while streaming", () => {
    const r = prepareHtml(page, { streaming: true });
    expect(r.scripts).toEqual([]);
    expect(r.handlers).toEqual([]);
    expect(r.html).not.toContain("onclick");
    expect(r.html).not.toContain("function go");
  });

  it("drops <base> and meta refresh", () => {
    const src = `<head><base href="https://x"><meta http-equiv="Refresh" content="0;url=https://x"><meta charset="utf-8"></head><p>a</p>`;
    expect(prepareHtml(src).html).toBe(`<head><meta charset="utf-8"></head><p data-tz-id="${at(src, "<p>")}">a</p>`);
  });
});

describe("sanitizeSvg", () => {
  const clean = (src: string): string => sanitizeSvg(src).svg;

  it("keeps a normal drawing and gives each element its id", () => {
    const src = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">\n  <defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>\n  <rect width="10" height="10" fill="url(#g)"/>\n  <text x="1" y="2">a &amp; b &lt; c</text>\n</svg>`;
    const r = sanitizeSvg(src);
    expect(r.svg).toContain(`<svg data-tz-id="1:1" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">`);
    expect(r.svg).toContain(`<linearGradient data-tz-id="2:9" id="g">`);
    expect(r.svg).toContain(`<rect data-tz-id="3:3" width="10" height="10" fill="url(#g)"/>`);
    expect(r.svg).toContain("a &amp; b &lt; c");
    expect(r.ids).toBe(6);
  });

  it("removes scripts, handlers, foreignObject and anything that can load code", () => {
    const out = clean(
      `<svg onload="alert(1)"><script>alert(1)</script><g onclick='x()'><rect onmouseover="y()" width="1"/></g>` +
        `<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil"></iframe></body></foreignObject>` +
        `<iframe src="https://evil"></iframe><object data="x"></object><embed src="x"><link rel="stylesheet" href="https://evil/x.css"><form action="https://evil"><input></form></svg>`,
    );
    expect(out).not.toMatch(/script|onload|onclick|onmouseover|foreignObject|iframe|object|embed|link|form|input|evil|alert/i);
    expect(out).toContain("<rect");
    expect(out).toContain('width="1"');
  });

  it("allows only local and data-image hrefs", () => {
    const out = clean(
      `<svg><use href="#a"/><use xlink:href="https://evil/x.svg#a"/><a href="javascript:alert(1)"><text>x</text></a><a href=" jav&#x61;script:alert(1)"><text>y</text></a>` +
        `<image href="data:image/png;base64,AAAA"/><image href="https://evil/p.png"/><image href="data:text/html;base64,AAAA"/></svg>`,
    );
    expect(out).toContain('href="#a"');
    expect(out).toContain('href="data:image/png;base64,AAAA"');
    expect(out).not.toMatch(/evil|javascript|jav&#|text\/html/i);
  });

  it("removes css that loads or runs anything, inline and in <style>", () => {
    const out = clean(
      `<svg><style>@import url(https://evil/x.css); .a{fill:red;background:url(https://evil/p.png)} .b{fill:url(#g)} .c{width:expression(alert(1))}</style>` +
        `<rect style="fill:url(https://evil/x);stroke:url(#g)" fill="url(https://evil/y)"/></svg>`,
    );
    expect(out).not.toMatch(/evil|@import|expression/i);
    expect(out).toContain("fill:red");
    expect(out).toContain("url(#g)");
  });

  it("drops animations that set an href or an event handler", () => {
    const out = clean(`<svg><a><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="onmouseover" to="alert(1)"/><circle r="1"><animate attributeName="r" values="1;2" dur="1s"/></circle></a></svg>`);
    expect(out).not.toMatch(/javascript|onmouseover|attributeName="href"/i);
    expect(out).toContain('attributeName="r"');
  });

  it("writes attribute values out itself: no way to break out of a quote or a tag", () => {
    const out = clean(`<svg><rect width='1" onload="alert(1)' height="2<script>"/></svg>`);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/"\s+onload/);
    expect(out).toContain("&quot;");
  });

  it("wraps bare shapes, drops HTML wrappers and comments, and survives a half-written drawing", () => {
    expect(clean(`<!-- c --><circle r="1"/>`)).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"><circle data-tz-id="1:\d+" r="1"\/><\/svg>$/);
    expect(clean(`<div><svg><g><rect width="1"/></g></svg></div>`)).toBe(`<svg data-tz-id="1:6"><g data-tz-id="1:11"><rect data-tz-id="1:14" width="1"/></g></svg>`);
    expect(clean(`<svg><g><rect width="1"/><path d="M0 0 L`)).toBe(`<svg data-tz-id="1:1"><g data-tz-id="1:6"><rect data-tz-id="1:9" width="1"/>`);
    expect(clean(`<svg><![CDATA[ a < b ]]></svg>`)).toContain("a &lt; b");
  });

  it("sanitizeCss keeps ordinary rules", () => {
    expect(sanitizeCss(".a{fill:#fff;stroke:url(#g)} .b{background:url(data:image/png;base64,AA==)}")).toBe(".a{fill:#fff;stroke:url(#g)} .b{background:url(data:image/png;base64,AA==)}");
  });
});

describe("tokenize", () => {
  it("handles unquoted attributes, bare attributes and self-closing tags", () => {
    const toks = tokenize(`<input type=text disabled value='a b'/><p>`);
    const open = toks[0]!;
    expect(open.k).toBe("open");
    if (open.k !== "open") return;
    expect(open.selfClose).toBe(true);
    expect(open.attrs.map((a) => [a.name, a.value])).toEqual([["type", "text"], ["disabled", null], ["value", "a b"]]);
  });
});
