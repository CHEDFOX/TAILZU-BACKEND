/**
 * The assistant's words in Hinglish: the translator is given the design's own
 * lines (connectors/words.ts) instead of guessing at them, so a Hinglish
 * profile reads exactly what was approved and none of it goes to the model.
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
          return { choices: [{ message: { content: JSON.stringify({ items: items.map((s) => "MODEL:" + s) }) } }] };
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
const { EN, HG, hinglishSeeds, wordsFor } = await import("../src/connectors/words.js");

const ctx = (extra: Record<string, unknown>) =>
  ({ personality: {}, language: "hinglish", formFactor: "desktop", can: new Set(["DeskShell", "DeskConnectors"]), ...extra }) as never;
const notion = { id: "notion", name: "Notion", category: "Docs", oneLine: "Pages.", auth: "oauth", connected: true, level: "draft", auto: [] };

describe("the assistant's words", () => {
  it("every English line has its Hinglish", () => {
    expect(Object.keys(HG).sort()).toEqual(Object.keys(EN).sort());
    expect(wordsFor("hinglish")("a2.q", { app: "Gmail" })).toBe("Gmail mein main kitna kar sakta hoon?");
    expect(wordsFor("en")("a2.q", { app: "Gmail" })).toBe("How far can I go in Gmail?");
    expect(hinglishSeeds(["Notion"]).get("Disconnect Notion")).toBe("Notion hatao");
  });

  it("a Hinglish profile reads the design's words on the desk, and the model is not asked for them", async () => {
    seen.items.length = 0;
    const s = buildScreen("desk_settings", ctx({ assistant: { apps: [notion], names: { notion: "Notion" } } }))!;
    const json = JSON.stringify(await localize(s, "hinglish"));
    for (const w of ["Jude hue apps", "Jud gaya", "Dekh sakta hoon", "Draft kar sakta hoon", "Bhej sakta hoon", "Notion mein main kitna kar sakta hoon?", "Notion hatao", "Main draft likhta hoon. Kuch bahar nahi jaata."]) {
      expect(json, w).toContain(w);
    }
    for (const w of ["Connected apps", "Can look", "How far can I go in Notion?", "Disconnect Notion"]) expect(seen.items, w).not.toContain(w);
  });

  it("the Tasks page too", async () => {
    seen.items.length = 0;
    const s = buildScreen("desk_tasks", ctx({ assistant: { tasks: [], names: {} } }))!;
    const json = JSON.stringify(await localize(s, "hinglish"));
    expect(json).toContain("Abhi kuch nahi.");
    expect(json).toContain("Kaam");
    expect(seen.items).not.toContain("Tasks");
  });
});
