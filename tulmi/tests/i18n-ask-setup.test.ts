/**
 * Ask's one-time setup card, translated whole. Its words are in props of its
 * own (desk.ts askSetupCard, the names permissions-spec §4 fixes for the
 * window), and the localizer translated only the ones every node shares: a
 * German profile got its `title` in German and "what you see.", the rows and
 * every button in English.
 */
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ items: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: { messages: Array<{ content: string }> }) => {
          const input = body.messages[1]!.content;
          const items = JSON.parse(input.slice(input.indexOf("Input JSON:") + "Input JSON:".length)) as string[];
          seen.items.push(...items);
          return { choices: [{ message: { content: JSON.stringify({ items: items.map((s) => "DE:" + s) }) } }] };
        },
      },
    };
  },
}));
// The translation cache stays in memory: nothing is read from or written to
// the working directory's data/i18n.
vi.mock("node:fs/promises", () => ({
  readFile: async () => { throw new Error("no cache here"); },
  writeFile: async () => {},
  mkdir: async () => {},
}));

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

const { localize } = await import("../src/experience/i18n.js");
const { buildScreen } = await import("../src/experience/catalog.js");

type AnyNode = { type?: string; props?: Record<string, any>; children?: AnyNode[] };
function cardsOf(root: unknown): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const n = v as AnyNode;
    if (n.type === "DeskAskSetup") out.push(n);
    for (const c of Object.values(n)) if (c && typeof c === "object") walk(c);
  };
  walk(root);
  return out;
}
const ctx = (os: string) => ({ personality: {}, language: "de", formFactor: "desktop", os, can: new Set(["DeskShell", "DeskAskSetup"]) }) as never;
// What is not copy: where the card is, its classes, the policy's address.
const NOT_COPY = new Set(["place", "cls", "policyUrl"]);

describe("Ask's setup card for a non-English profile", () => {
  for (const id of ["desk_today", "desk_settings"]) {
    it(`${id}: every word on it is translated; its keys, place and address are not`, async () => {
      const en = buildScreen(id, ctx("mac")) as any;
      const [card] = cardsOf(en.root);
      expect(card).toBeDefined();
      const de = (await localize(en, "de")) as any;
      const [out] = cardsOf(de.root);
      for (const [k, v] of Object.entries(card!.props!)) {
        if (k === "rows") continue;
        if (NOT_COPY.has(k)) expect(out!.props![k], k).toEqual(v);
        else expect(out!.props![k], k).toBe("DE:" + v);
      }
      expect(out!.props!.rows).toEqual(card!.props!.rows.map((r: any) => ({ key: r.key, title: "DE:" + r.title, sub: "DE:" + r.sub })));
      // Asked of the translator, the headline's second half and the rows among them.
      expect(seen.items).toEqual(expect.arrayContaining(["what you see.", "Read the screen", "Allow", "Turn off", "Restart X0 Bot to finish"]));
      // The card's own identifiers never are.
      expect(seen.items).not.toContain("read");
      expect(seen.items).not.toContain("pictures");
      expect(seen.items.some((s) => /^https:/.test(s))).toBe(false);
    });
  }

  it("only this node's own props: another node with an \"allow\" prop is left alone", async () => {
    const resp = { title: "T", root: { type: "Stack", props: { allow: "yes", on: "tap", content: "Continue" } } } as never;
    const out = (await localize(resp, "de")) as any;
    expect(out.root.props).toEqual({ allow: "yes", on: "tap", content: "DE:Continue" });
  });
});
