/**
 * The screen reply (POST /v1/draft) is the writer role from v5, and REPLY_PROMPT_VERSION rolls it back.
 *
 * The one file prompt left in the product was shared/prompts/reply.v4.md. From v5 the reply is the same `writer` role as every other
 * writing path (principles/roles.ts), with its app, recipient, language setting and voice as fenced data after the stable block
 * (pipeline/assistPrompt.ts replyContext). The files reply.v1 to reply.v4 and their loader stay, so exporting REPLY_PROMPT_VERSION=v4
 * sends the old prompt again without a code change: that is the rollback, and it is held here, byte for byte.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<Array<{ role: string; content: string }>> = [];
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async (req: { messages: Array<{ role: string; content: string }> }) => {
      calls.push(req.messages);
      return { choices: [{ message: { content: "Friday works for me." } }] };
    } } };
  },
}));

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { draftReply } = await import("../src/pipeline/cleanup.js");
const { buildReplySystem, replyIsAFile } = await import("../src/prompts.js");
const { resetConfigForTests } = await import("../src/config.js");
const { stableBlock } = await import("../src/principles/roles.js");

const version = (v: string | undefined) => {
  if (v === undefined) delete process.env.REPLY_PROMPT_VERSION;
  else process.env.REPLY_PROMPT_VERSION = v;
  resetConfigForTests();
};

beforeEach(() => { calls.length = 0; version(undefined); });

describe("the screen reply's prompt version", () => {
  it("is the writer role by default (v5): its stable block, then the reply's data and the screen as <around>", async () => {
    expect(replyIsAFile()).toBe(false);
    const out = await draftReply("lunch friday?", "say yes", { targetApp: "WhatsApp" }, "Aarav");
    expect(out).toBe("Friday works for me.");
    const [system, user] = calls[0]!;
    expect(system!.content).toBe(stableBlock("writer"));
    expect(user!.content).toContain("It goes in WhatsApp, as a reply to Aarav.");
    expect(user!.content).toContain("<around>\nlunch friday?\n</around>");
    expect(user!.content.endsWith("<said>\nsay yes\n</said>")).toBe(true);
  });

  it("rolls back to the file with REPLY_PROMPT_VERSION=v4, exactly as it was sent: the rendered file, and the screen and intent in their own fences", async () => {
    version("v4");
    expect(replyIsAFile()).toBe(true);
    await draftReply("lunch friday?", "say yes", { targetApp: "WhatsApp", language: "hi" }, "Aarav");
    const [system, user] = calls[0]!;
    expect(system!.content).toBe(buildReplySystem({ targetApp: "WhatsApp", language: "hi" }, "Aarav", "v4"));
    expect(system!.content.startsWith("You are writing a reply for someone, as them.")).toBe(true);
    expect(system!.content).toContain("They are replying in WhatsApp, to Aarav.");
    expect(user!.content).toBe(
      "SCREEN CONTENT (what I'm replying to):\n<screen>\nlunch friday?\n</screen>\n\nMY INTENT (what I want to say back):\n<intent>\nsay yes\n</intent>",
    );
  });

  it("v1 to v4 are files, and anything newer is the role", () => {
    for (const v of ["v1", "v2", "v3", "v4"]) expect(replyIsAFile(v), v).toBe(true);
    for (const v of ["v5", "v6", "v10"]) expect(replyIsAFile(v), v).toBe(false);
  });
});
