import { describe, expect, it } from "vitest";
import { renderMarkdown, safeImageUrl, safeLinkUrl } from "../lib/markdown.js";

const md = (s: string): string => renderMarkdown(s).replace(/^<article class="tz-md">/, "").replace(/<\/article>$/, "");

describe("renderMarkdown", () => {
  it("headings (ATX and setext) get ids, paragraphs get inline markup", () => {
    expect(md("# Title\n\nSome **bold**, *italic*, _also italic_, ~~gone~~ and `code <b>`.\n\nSecond\nline  \nbreak\n\nSub\n---\n\nTop\n===")).toBe(
      `<h1 id="title">Title</h1>\n<p>Some <strong>bold</strong>, <em>italic</em>, <em>also italic</em>, <del>gone</del> and <code>code &lt;b&gt;</code>.</p>\n<p>Second\nline<br>\nbreak</p>\n<h2 id="sub">Sub</h2>\n<h1 id="top">Top</h1>`,
    );
  });

  it("makes duplicate heading ids unique", () => {
    expect(md("## A\n\n## A\n\n## A")).toBe(`<h2 id="a">A</h2>\n<h2 id="a-1">A</h2>\n<h2 id="a-2">A</h2>`);
  });

  it("lists: unordered, ordered with a start, nested, tight and loose, tasks", () => {
    expect(md("- a\n- b\n  - b1\n  - b2\n- c")).toBe(`<ul><li>a</li><li>b\n<ul><li>b1</li><li>b2</li></ul></li><li>c</li></ul>`);
    expect(md("3. x\n4. y")).toBe(`<ol start="3"><li>x</li><li>y</li></ol>`);
    expect(md("- a\n\n- b")).toBe(`<ul><li><p>a</p></li><li><p>b</p></li></ul>`);
    expect(md("- [x] done\n- [ ] todo")).toBe(`<ul><li class="task"><input type="checkbox" disabled checked> done</li><li class="task"><input type="checkbox" disabled> todo</li></ul>`);
    expect(md("1. one\n2. two\n\ntext")).toBe(`<ol><li>one</li><li>two</li></ol>\n<p>text</p>`);
  });

  it("code: fenced with a language, unclosed while streaming, indented; nothing inside is markup", () => {
    expect(md("```ts\nconst a = <b>*x*</b>;\n```")).toBe(`<pre><code class="language-ts">const a = &lt;b&gt;*x*&lt;/b&gt;;</code></pre>`);
    expect(md("```\nstill writing <i>")).toBe(`<pre><code>still writing &lt;i&gt;</code></pre>`);
    expect(md("    indented\n    code")).toBe(`<pre><code>indented\ncode</code></pre>`);
    expect(md("~~~\n```\n~~~")).toBe("<pre><code>```</code></pre>");
  });

  it("tables with alignment and inline markup in cells", () => {
    const html = md("| Name | Qty | Note |\n|:-----|----:|:----:|\n| **a** | 1 | x \\| y |\n| b | 2 | |");
    expect(html).toContain(`<th style="text-align:left">Name</th><th style="text-align:right">Qty</th><th style="text-align:center">Note</th>`);
    expect(html).toContain(`<td style="text-align:left"><strong>a</strong></td><td style="text-align:right">1</td><td style="text-align:center">x | y</td>`);
    expect(html).toContain(`<td style="text-align:left">b</td>`);
    expect((html.match(/<tr>/g) ?? []).length).toBe(3);
  });

  it("block quotes nest and hold blocks", () => {
    expect(md("> quote\n> - item\n>\n> > inner")).toBe(`<blockquote><p>quote</p>\n<ul><li>item</li></ul>\n<blockquote><p>inner</p></blockquote></blockquote>`);
  });

  it("rules", () => {
    expect(md("a\n\n***\n\nb")).toBe(`<p>a</p>\n<hr>\n<p>b</p>`);
  });

  it("links open safely and only to https, http, mailto or an anchor", () => {
    expect(md("[x](https://example.com/a?b=1&c=2 \"T\")")).toBe(`<p><a href="https://example.com/a?b=1&amp;c=2" title="T" rel="noopener noreferrer nofollow" target="_blank">x</a></p>`);
    expect(md("see <https://example.com> and https://example.org/p, ok")).toBe(
      `<p>see <a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">https://example.com</a> and <a href="https://example.org/p" rel="noopener noreferrer nofollow" target="_blank">https://example.org/p</a>, ok</p>`,
    );
    expect(md("[top](#title) [mail](mailto:a@b.c)")).toContain(`<a href="#title"`);
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "//evil.example", "/relative", "file:///etc/passwd"]) {
      const out = md(`[click](${bad})`);
      expect(out, bad).not.toMatch(/<a /);
      expect(out, bad).toContain("click");
    }
  });

  it("images only from https or a data: image", () => {
    expect(md("![alt \"q\"](https://example.com/p.png)")).toContain(`<img src="https://example.com/p.png" alt="alt &quot;q&quot;" loading="lazy" decoding="async" referrerpolicy="no-referrer">`);
    expect(md("![d](data:image/png;base64,iVBORw0KGgo=)")).toContain(`src="data:image/png;base64,iVBORw0KGgo="`);
    for (const bad of ["http://example.com/p.png", "javascript:alert(1)", "data:text/html;base64,AAAA", "data:image/svg+xml,<svg onload=alert(1)>", "//x/y.png"]) {
      expect(md(`![a](${bad})`), bad).not.toMatch(/<img/);
    }
  });

  it("has no raw HTML: every tag the author wrote is text", () => {
    const evil = `<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<a href="javascript:alert(1)">x</a>\n\n**<b onmouseover=alert(1)>b</b>**\n\n\`<i>\`\n\n[<s>t</s>](https://e.com "<u>")\n\n| <h1>a</h1> |\n|---|\n| <iframe src=//x> |\n\n> <details open ontoggle=alert(1)>\n\n- <svg onload=alert(1)>\n\n# <u>h</u>\n\n&lt;ok&gt; &amp; &copy; AT&T`;
    const out = md(evil);
    expect(out).not.toMatch(/<(?:script|img|svg|iframe|details|b |i>|s>|u>|h1>)/i);
    expect(out.replace(/<(?:\/?(?:p|a|h[1-6]|strong|em|code|pre|table|thead|tbody|tr|th|td|ul|ol|li|blockquote|div|br|hr)(?:\s[^<>]*)?)>/g, "")).not.toMatch(/<[a-z!\/]/i);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("&lt;ok&gt; &amp; &copy; AT&amp;T");
  });

  it("escapes backslash-escaped markup and never breaks an attribute", () => {
    expect(md("\\*not em\\* \\[not link\\](x)")).toBe(`<p>*not em* [not link](x)</p>`);
    const tag = md(`[a](https://e.com/"onmouseover="x)`).match(/<a [^>]*>/)![0];
    expect(tag.split('"').length - 1).toBe(6); // href, rel, target: three quoted values and nothing else
    const img = md(`![a" onerror="x](https://e.com/p.png)`).match(/<img [^>]*>/)![0];
    expect(img.split('"').length - 1).toBe(10); // src, alt, loading, decoding, referrerpolicy: five quoted values and nothing else
    expect(img).toContain('alt="a&quot; onerror=&quot;x"');
  });

  it("renders a half-written document as far as it goes, and never throws", () => {
    const whole = "# T\n\nSome *text* with [a link](https://e.com) and `code`.\n\n- a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n\n> q";
    for (let cut = 0; cut <= whole.length; cut++) expect(typeof renderMarkdown(whole.slice(0, cut))).toBe("string");
    expect(md("Some **half bold and `half code")).toBe("<p>Some **half bold and `half code</p>");
    expect(md("[half link](https://e")).toBe("<p>[half link](https://e</p>");
    const t = performance.now();
    renderMarkdown("*a ".repeat(20000));
    renderMarkdown("[a](".repeat(5000));
    renderMarkdown("- a\n".repeat(5000));
    expect(performance.now() - t).toBeLessThan(3000);
  });

  it("exports its url checks", () => {
    expect(safeLinkUrl("https://a.b")).toBe("https://a.b");
    expect(safeLinkUrl("javascript:1")).toBeNull();
    expect(safeImageUrl("http://a.b/p.png")).toBeNull();
  });
});
