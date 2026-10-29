/**
 * The bot's artifact tools (src/artifacts/tools.ts): artifact_create, artifact_update (exact, unique replacements, all or nothing, a clear
 * failure naming the edit that missed) and artifact_rewrite, in the brain's ToolDef format, for any bot.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { rig, FAKE_STRIPE } = await import("./artifacts-rig.js");
const { ARTIFACT_TOOLS, ARTIFACT_TOOL_NAMES, runArtifactTool, isArtifactTool } = await import("../src/artifacts/tools.js");

const PAGE = `<main>
  <h1>Hello</h1>
  <p class="lead">Welcome to the shop</p>
  <p class="lead">Welcome back</p>
  <button id="buy">Buy</button>
</main>
`;

async function setup() {
  const r = rig();
  const ctx = { userId: "u1" };
  const run = (name: string, args: unknown) => runArtifactTool(r.service, ctx, { name, arguments: typeof args === "string" ? args : JSON.stringify(args) });
  const made = await run("artifact_create", { type: "html", title: "Shop", content: PAGE });
  expect(made.ok).toBe(true);
  return { ...r, run, id: made.artifactId! };
}

describe("the definitions", () => {
  it("are three tools in the brain's ToolDef format, with schemas that require what they need", () => {
    expect(ARTIFACT_TOOLS.map((t) => t.name)).toEqual([...ARTIFACT_TOOL_NAMES]);
    for (const t of ARTIFACT_TOOLS) {
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toMatchObject({ type: "object", additionalProperties: false });
    }
    const by = Object.fromEntries(ARTIFACT_TOOLS.map((t) => [t.name, t.parameters as { required: string[] }]));
    expect(by.artifact_create!.required).toEqual(["type", "title", "content"]);
    expect(by.artifact_update!.required).toEqual(["id", "edits"]);
    expect(by.artifact_rewrite!.required).toEqual(["id", "content"]);
    expect(isArtifactTool("artifact_update")).toBe(true);
    expect(isArtifactTool("edit_file")).toBe(false);
  });

  it("tell the model to prefer an update, and what an update must look like", () => {
    const text = (n: string) => ARTIFACT_TOOLS.find((t) => t.name === n)!.description;
    expect(text("artifact_update")).toMatch(/PREFER THIS to artifact_rewrite/);
    expect(text("artifact_update")).toMatch(/ONCE.*matched against the artifact as it is now.*All the edits apply or none does/s);
    expect(text("artifact_rewrite")).toMatch(/ONLY when most of it changes/);
    expect(text("artifact_create")).toMatch(/NO network.*react, react-dom, recharts, lucide-react, d3, three, mermaid/s);
  });
});

describe("artifact_create", () => {
  it("makes the artifact and says its id, version and what it cost", async () => {
    const { run, service } = await setup();
    const r = await run("artifact_create", { type: "svg", title: "Dot", content: `<svg viewBox="0 0 4 4"><circle r="1"/></svg>` });
    expect(r).toMatchObject({ ok: true, version: 1 });
    expect(r.content).toMatch(/Made "Dot" \(0\.0 KB\): artifact [0-9a-f-]{36}, now version 1\.$/);
    expect((await service.get("u1", r.artifactId!)).content).toContain("<circle");
  });

  it("refuses what the validation refuses, in words, and keeps nothing", async () => {
    const { run, service } = await setup();
    const before = await service.list("u1");
    const secret = await run("artifact_create", { type: "html", title: "Leak", content: `<p>${FAKE_STRIPE}</p>` });
    expect(secret.ok).toBe(false);
    expect(secret.content).toMatch(/not kept.*Stripe key/);
    expect(secret.content).not.toContain(FAKE_STRIPE);
    const lib = await run("artifact_create", { type: "react", title: "X", content: `import dayjs from "dayjs";\nexport default () => null;` });
    expect(lib.content).toMatch(/import "dayjs" is not available/);
    expect((await run("artifact_create", { type: "word", title: "X", content: "x" })).content).toMatch(/type is one of html, react, svg, mermaid, markdown/);
    expect((await run("artifact_create", { type: "html", title: "X" })).content).toMatch(/content is the artifact's source/);
    expect(await service.list("u1")).toHaveLength(before.length);
  });

  it("keeps a project's id when the bot works in one", async () => {
    const { service } = await setup();
    const pid = "11111111-1111-4111-8111-111111111111";
    const r = await runArtifactTool(service, { userId: "u1", projectId: pid }, { name: "artifact_create", arguments: JSON.stringify({ type: "markdown", title: "Plan", content: "# Plan" }) });
    expect((await service.list("u1", { projectId: pid })).map((a) => a.id)).toEqual([r.artifactId]);
  });
});

describe("artifact_update", () => {
  it("applies every edit, as a patch of just those spans, and names the new version", async () => {
    const { run, id, store, service } = await setup();
    const r = await run("artifact_update", { id, edits: [{ old: "<h1>Hello</h1>", new: "<h1>Hello there</h1>" }, { old: "Welcome to the shop", new: "Welcome to our shop" }] });
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(r.content).toMatch(/Changed "Shop".*now version 2/);
    expect((await service.get("u1", id)).content).toBe(PAGE.replace("<h1>Hello</h1>", "<h1>Hello there</h1>").replace("Welcome to the shop", "Welcome to our shop"));
    const v = (await store.listVersions(id))[0]!;
    expect(v).toMatchObject({ version: 2, kind: "patch", madeBy: "bot", note: "2 edits" });
    expect(v.storedBytes).toBeLessThan(160);
  });

  it("applies none when one misses, names the one that missed, and leaves the artifact exactly as it was", async () => {
    const { run, id, service } = await setup();
    const r = await run("artifact_update", { id, edits: [{ old: "<h1>Hello</h1>", new: "<h1>Hi</h1>" }, { old: "Welcome to the store", new: "x" }, { old: "Buy", new: "Purchase" }] });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/^Edit 2 did not apply: its old text "Welcome to the store" is not in the artifact as it is now/);
    expect(r.content).toMatch(/Nothing was changed\.$/);
    const now = await service.get("u1", id);
    expect(now.version).toBe(1);
    expect(now.content).toBe(PAGE);
  });

  it("refuses an old text that is not unique, with how many times it is there", async () => {
    const { run, id } = await setup();
    const r = await run("artifact_update", { id, edits: [{ old: '<p class="lead">', new: '<p class="intro">' }] });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Edit 1 did not apply: its old text "<p class=\\"lead\\">" is in the artifact 2 times\. Include more of the lines around it/);
  });

  it("is matched against the artifact, so a second edit cannot lean on the first", async () => {
    const { run, id } = await setup();
    const r = await run("artifact_update", { id, edits: [{ old: "Buy", new: "Order" }, { old: "Order", new: "Order now" }] });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Edit 2 did not apply.*not against the edits before it/);
  });

  it("checks the result like any version: an edit that would put a secret in is refused", async () => {
    const { run, id, service } = await setup();
    const r = await run("artifact_update", { id, edits: [{ old: "<h1>Hello</h1>", new: `<h1>${FAKE_STRIPE}</h1>` }] });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Stripe key/);
    expect((await service.get("u1", id)).version).toBe(1);
  });

  it("is the owner's only: another person's id is the same plain not found", async () => {
    const { id, service } = await setup();
    const other = await runArtifactTool(service, { userId: "u2" }, { name: "artifact_update", arguments: JSON.stringify({ id, edits: [{ old: "Buy", new: "Steal" }] }) });
    expect(other).toEqual({ ok: false, content: "I couldn't find that artifact." });
    const none = await runArtifactTool(service, { userId: "u1" }, { name: "artifact_update", arguments: JSON.stringify({ id: "nope", edits: [{ old: "a", new: "b" }] }) });
    expect(none.content).toBe(other.content);
  });
});

describe("artifact_rewrite", () => {
  it("replaces the text, and says what it cost", async () => {
    const { run, id, service } = await setup();
    const next = `<section>\n  <h2>Fresh</h2>\n  <p>A different page entirely.</p>\n</section>\n`;
    const r = await run("artifact_rewrite", { id, content: next });
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(r.content).toMatch(/Rewrote "Shop".*now version/);
    expect(r.content).not.toMatch(/next time/);
    expect((await service.get("u1", id)).content).toBe(next);
  });

  it("is kept when little changed, but says what would have cost a fraction of it", async () => {
    const { run, id } = await setup();
    const r = await run("artifact_rewrite", { id, content: PAGE.replace("Buy", "Order") });
    expect(r.ok).toBe(true);
    expect(r.content).toMatch(/Only about \d+% of it changed: next time use artifact_update/);
  });

  it("refuses text that is the same, empty, or not text", async () => {
    const { run, id } = await setup();
    expect((await run("artifact_rewrite", { id, content: PAGE })).content).toMatch(/would change nothing/);
    expect((await run("artifact_rewrite", { id, content: "  " })).content).toMatch(/empty/);
    expect((await run("artifact_rewrite", { id, content: 5 })).content).toMatch(/whole new source, as text/);
  });
});

describe("a call that is not usable", () => {
  it("is answered, never thrown", async () => {
    const { run } = await setup();
    expect((await run("artifact_update", "{not json")).content).toMatch(/not a JSON object/);
    expect((await run("artifact_update", "[1]")).content).toMatch(/not a JSON object/);
    expect((await run("artifact_frobnicate", {})).content).toMatch(/no tool called artifact_frobnicate/);
  });
});
