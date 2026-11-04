/**
 * A WHOLE ARTIFACT OUT OF A MODEL'S ANSWER (src/artifacts/edit.ts contentOf): the fence taken off, and the words a model says around
 * it left out. Seen live (2026-11-04): DeepSeek V4.1 Flash, asked for a dashboard page, wrote "Here is an HTML document that…" before
 * the fence and a "### Dashboard Layout" note and an "Optimization Tip" after it, and both ended up on the page.
 */
import { describe, expect, it } from "vitest";

const { contentOf, unfence } = await import("../src/artifacts/edit.js");

const PAGE = "<!doctype html>\n<html><body><h1>Sales</h1></body></html>";

describe("contentOf", () => {
  it("keeps the fenced artifact and drops the words around it", () => {
    const answer = `Here is an HTML document that renders a dashboard.\n\`\`\`html\n${PAGE}\n\`\`\`\n### Dashboard Layout\n- KPI cards\n\n**Optimization Tip:** use real data.`;
    expect(contentOf(answer, "html")).toBe(PAGE);
    expect(contentOf(`Sure! Here it is:\n\`\`\`svg\n<svg viewBox="0 0 10 10"></svg>\n\`\`\``, "svg")).toBe('<svg viewBox="0 0 10 10"></svg>');
    expect(contentOf("Here's the diagram:\n```mermaid\nflowchart LR\n  A --> B\n```", "mermaid")).toBe("flowchart LR\n  A --> B");
  });
  it("takes the largest block when there are several (a usage snippet beside the artifact)", () => {
    expect(contentOf(`Use it like this:\n\`\`\`bash\nopen page.html\n\`\`\`\nThe page:\n\`\`\`html\n${PAGE}\n\`\`\``, "html")).toBe(PAGE);
  });
  it("is unfence as before for a plain answer or one fence round the whole of it", () => {
    expect(contentOf(PAGE, "html")).toBe(PAGE);
    expect(contentOf(`\`\`\`html\n${PAGE}\n\`\`\``, "html")).toBe(unfence(`\`\`\`html\n${PAGE}\n\`\`\``));
  });
  it("leaves an artifact that carries a fence inside it, and markdown, whose code blocks are content", () => {
    const withPre = "<!doctype html><html><body><pre>```js\nlet a = 1\n```</pre></body></html>";
    expect(contentOf(withPre, "html")).toBe(withPre);
    const component = "export default function Readme() {\n  return <pre>{`\\`\\`\\`js\\nx\\n\\`\\`\\``}</pre>;\n}";
    expect(contentOf(component, "react")).toBe(component);
    const md = "# Setup\n\nRun this:\n\n```bash\nnpm i\n```\n\nThen start it.";
    expect(contentOf(md, "markdown")).toBe(md);
  });
});
