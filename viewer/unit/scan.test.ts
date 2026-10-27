import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { injectJsxIds } from "../lib/scan.js";
import { lineColAt, lineStarts, toOriginalOffset } from "../lib/text.js";

const idsOf = (code: string): string[] => [...code.matchAll(/data-tz-id="(\d+:\d+)"/g)].map((m) => m[1]!);
const strip = (code: string): string => code.replace(/ data-tz-id="\d+:\d+"/g, "");
/** "line:col" of the nth (1-based) occurrence of `needle`, counted the way the scanner must. */
const at = (src: string, needle: string, nth = 1): string => {
  let from = -1;
  for (let k = 0; k < nth; k++) from = src.indexOf(needle, from + 1);
  expect(from).toBeGreaterThanOrEqual(0);
  const { line, col } = lineColAt(lineStarts(src), from);
  return `${line}:${col}`;
};

describe("injectJsxIds", () => {
  it("puts the position of each element's < after its tag name", () => {
    const src = `export default function App() {\n  return <div className="a"><span>hi</span></div>;\n}\n`;
    const r = injectJsxIds(src);
    expect(r.code).toContain(`<div data-tz-id="${at(src, "<div")}" className="a"><span data-tz-id="${at(src, "<span")}">hi</span></div>`);
    expect(at(src, "<div")).toBe("2:10");
    expect(r.ids).toBe(2);
    expect(strip(r.code)).toBe(src);
  });

  it("handles nested JSX, self-closing tags and component names", () => {
    const src = [
      "const A = () => (",
      "  <Card.Root>",
      "    <img src='x.png' />",
      "    <Icon name=\"a\"/>",
      "    <ul>",
      "      <li>1</li>",
      "    </ul>",
      "  </Card.Root>",
      ");",
    ].join("\n");
    const r = injectJsxIds(src);
    expect(idsOf(r.code)).toEqual([at(src, "<Card.Root"), at(src, "<img"), at(src, "<Icon"), at(src, "<ul>"), at(src, "<li>")]);
    expect(at(src, "<img")).toBe("3:5");
    expect(r.code).toContain(`<Card.Root data-tz-id="2:3">`);
    expect(r.code).toContain(`<img data-tz-id="3:5" src='x.png' />`);
    expect(r.code).toContain(`<Icon data-tz-id="4:5" name="a"/>`);
  });

  it("gives fragments no id", () => {
    const src = `const A = () => <><b>x</b><Fragment><i/></Fragment><React.Fragment key="k"><u/></React.Fragment></>;`;
    const r = injectJsxIds(src);
    expect(r.code).toContain("<>");
    expect(r.code).toContain("</>");
    expect(r.code).toContain("<Fragment><i");
    expect(r.code).toContain(`<React.Fragment key="k"><u`);
    expect(r.ids).toBe(3); // b, i, u
  });

  it("does not mistake comparisons and TypeScript generics for elements", () => {
    const src = [
      "import { useState } from 'react';",
      "type P<T> = { a: Array<T>; b: Record<string, Map<number, T[]>> };",
      "const f = <T,>(x: T) => x;",
      "const g = <T extends object>(x: T): T => x;",
      "type Fn = <U>(a: U) => U;",
      "export default function App() {",
      "  const [n, setN] = useState<number>(0);",
      "  const xs = new Set<string>();",
      "  if (n < 3 && n > 1) setN(n<2 ? 1 : 2);",
      "  for (let i = 0; i < 10; i++) {}",
      "  return <p>{n < 5 ? 'small' : 'big'}</p>;",
      "}",
    ].join("\n");
    const r = injectJsxIds(src);
    expect(idsOf(r.code)).toEqual([at(src, "<p>")]);
    expect(strip(r.code)).toBe(src);
  });

  it("is not fooled by < inside strings, template literals, comments, regexes and JSX attribute strings", () => {
    const src = [
      "const a = '<div>';",
      'const b = "<span>";',
      "const c = `<b>${1 < 2 ? `<i>` : '<u>'}</b>`;",
      "// <em> in a comment",
      "/* <strong> */",
      "const re = /<p>[</]/g;",
      "const d = 4 / 2 < 3;",
      "const E = () => <a title=\"<x>\" data-y='>' href=\"#\">1 &lt; 2</a>;",
    ].join("\n");
    const r = injectJsxIds(src);
    expect(idsOf(r.code)).toEqual([at(src, "<a title")]);
  });

  it("scans {} expressions inside JSX: attributes, children, spreads and nested elements", () => {
    const src = [
      "const A = ({ items, ...rest }) => (",
      "  <ul {...rest} onClick={() => go(<b>x</b>)} style={{ a: '}' }}>",
      "    {items.map((it) => (",
      "      <li key={it}>{`${it}`} {/* <c> */}</li>",
      "    ))}",
      "    {items.length > 2 && <li>more</li>}",
      "    text with 'quotes' and > and }",
      "  </ul>",
      ");",
    ].join("\n");
    const r = injectJsxIds(src);
    expect(idsOf(r.code)).toEqual([at(src, "<ul"), at(src, "<b>"), at(src, "<li key"), at(src, "<li>more")]);
  });

  it("puts an element in an attribute value after the attribute's own id", () => {
    const src = `const A = () => <Tip icon={<Star />} label=<b>x</b>>t</Tip>;`;
    expect(idsOf(injectJsxIds(src).code)).toEqual([at(src, "<Tip"), at(src, "<Star"), at(src, "<b>")]);
  });

  it("reads TypeScript syntax around JSX: type arguments on elements, as, satisfies, enums, interfaces", () => {
    const src = [
      "interface Props<T> { items: T[]; render: (t: T) => JSX.Element }",
      "enum Color { Red, Green }",
      "function List<T>({ items, render }: Props<T>) {",
      "  return <ul>{items.map((i) => render(i as T))}</ul>;",
      "}",
      "export default function App() {",
      "  return <List<string> items={['a']} render={(s) => <li>{s}</li>} />;",
      "}",
    ].join("\n");
    const r = injectJsxIds(src);
    expect(idsOf(r.code)).toEqual([at(src, "<ul>"), at(src, "<List<string>"), at(src, "<li>")]);
    expect(r.code).toContain(`<List<string> data-tz-id="7:10" items`);
  });

  it("counts lines the way editors do: \\r\\n once, tabs as one column", () => {
    const src = "const A = () => (\r\n\t<div>\r\n\t\t<b/>\r\n\t</div>\r\n);";
    expect(idsOf(injectJsxIds(src).code)).toEqual(["2:2", "3:3"]);
  });

  it("collects imports, and tells a type-only import from a real one", () => {
    const src = [
      "import React, { useState } from 'react';",
      'import * as d3 from "d3";',
      "import type { Foo } from './types';",
      "import './side-effect';",
      "export { x } from 'recharts';",
      "const m = await import('three');",
      "const s = 'from \"nope\"';",
    ].join("\n");
    const r = injectJsxIds(src);
    expect(r.imports.map((i) => [i.spec, i.typeOnly])).toEqual([
      ["react", false],
      ["d3", false],
      ["./types", true],
      ["./side-effect", false],
      ["recharts", false],
      ["three", false],
    ]);
    expect(src.slice(r.imports[0]!.offset, r.imports[0]!.offset + 7)).toBe("'react'");
  });

  it("puts a < that never closes back and reads on, so one stray type cannot swallow the file", () => {
    const src = [
      "const f: <T>(x: T) => T = (x) => x;",
      "export default function App() {",
      "  return <div>ok</div>;",
      "}",
    ].join("\n");
    const r = injectJsxIds(src);
    expect(idsOf(r.code)).toEqual([at(src, "<div>")]);
  });

  it("never throws on half-written source and stays quick", () => {
    const whole = `export default function App() {\n  const [a, setA] = useState(0);\n  return (\n    <div className="x">\n      <button onClick={() => setA(a + 1)}>{a} it's</button>\n      {a > 1 && <p>big</p>}\n    </div>\n  );\n}\n`;
    for (let cut = 0; cut <= whole.length; cut += 3) {
      const r = injectJsxIds(whole.slice(0, cut));
      expect(typeof r.code).toBe("string");
    }
    const evil = "<a ".repeat(20000);
    const t = performance.now();
    injectJsxIds(evil);
    injectJsxIds("x = <".repeat(20000));
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it("maps a position in the edited text back to the original", () => {
    const src = `const A = () => <div><b>x</b></div>;`;
    const r = injectJsxIds(src);
    const starts = lineStarts(src);
    const edited = r.code.indexOf("x</b>");
    const original = toOriginalOffset(r.inserts, edited);
    expect(original).toBe(src.indexOf("x</b>"));
    expect(lineColAt(starts, original)).toEqual({ line: 1, col: src.indexOf("x</b>") + 1 });
    // A position inside an insert maps to where the insert was made.
    const inside = r.code.indexOf("data-tz-id") + 3;
    expect(toOriginalOffset(r.inserts, inside)).toBe(src.indexOf("<div") + 4);
  });
});

// The same elements Sucrase's own tokenizer finds (its jsxTagStart tokens followed by a name, not `>`), on realistic artifacts.
describe("injectJsxIds against Sucrase's tokenizer", () => {
  const require = createRequire(import.meta.url);
  const { parse } = require("sucrase/dist/parser") as { parse: (code: string, jsx: boolean, ts: boolean, flow: boolean) => { tokens: { type: number; start: number; end: number }[] } };
  const { TokenType } = require("sucrase/dist/parser/tokenizer/types") as { TokenType: Record<string, number> };

  const sucraseElements = (src: string): string[] => {
    const { tokens } = parse(src, true, true, false);
    const starts = lineStarts(src);
    const out: string[] = [];
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k]!;
      if (t.type !== TokenType.jsxTagStart) continue;
      const next = tokens[k + 1]!;
      if (next.type === TokenType.slash) continue; // a closing tag
      if (next.type === TokenType.jsxTagEnd) continue; // a fragment
      const isFragmentName = src.slice(next.start, next.end) === "Fragment" || (src.slice(next.start, next.end) === "React" && src.slice(tokens[k + 3]!.start, tokens[k + 3]!.end) === "Fragment");
      if (isFragmentName) continue;
      const { line, col } = lineColAt(starts, t.start);
      out.push(`${line}:${col}`);
    }
    return out;
  };

  const samples: Record<string, string> = {
    counter: `import React, { useState } from "react";
import { Plus, Minus } from "lucide-react";

type Props = { start?: number };

export default function Counter({ start = 0 }: Props) {
  const [n, setN] = useState<number>(start);
  const label = n === 0 ? <em>zero</em> : n < 0 ? <em>negative</em> : null;
  return (
    <div className="p-4 flex gap-2 items-center">
      <button onClick={() => setN((v) => v - 1)} aria-label="less"><Minus size={16} /></button>
      <span data-n={n}>{n} {label}</span>
      <button onClick={() => setN((v) => v + 1)}><Plus size={16} /></button>
      {n > 10 && <p>That's a lot, isn't it? {"<tag>"}</p>}
    </div>
  );
}
`,
    chart: `import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
const data = [{ name: 'A', v: 1 }, { name: 'B', v: 3 }];
const fmt = (x: number) => x < 1 ? '<1' : String(x);
export default function Chart() {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <XAxis dataKey="name" />
        <YAxis tickFormatter={fmt} />
        <Tooltip formatter={(v: number) => [fmt(v), 'value']} />
        <Line type="monotone" dataKey="v" stroke="#8884d8" />
      </LineChart>
    </ResponsiveContainer>
  );
}
`,
    generics: `import { useRef, useReducer } from 'react';
type Action<T> = { type: 'add'; item: T } | { type: 'clear' };
function reducer<T>(state: T[], action: Action<T>): T[] { return action.type === 'add' ? [...state, action.item] : []; }
const Wrap = <T,>({ v }: { v: T }) => <i>{String(v)}</i>;
export default function App() {
  const ref = useRef<HTMLDivElement>(null);
  const [items, dispatch] = useReducer(reducer<string>, []);
  const cmp = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
  return (
    <div ref={ref} onClick={() => dispatch({ type: 'add', item: 'x' })}>
      {items.length < 3 ? items.map((s, i) => <Wrap key={i} v={s} />) : <b>full</b>}
      <p>{cmp(1, 2)}</p>
    </div>
  );
}
`,
  };

  for (const [name, src] of Object.entries(samples)) {
    it(`finds the same elements in: ${name}`, () => {
      const mine = idsOf(injectJsxIds(src).code);
      expect(mine).toEqual(sucraseElements(src));
      expect(mine.length).toBeGreaterThan(3);
    });
  }
});
