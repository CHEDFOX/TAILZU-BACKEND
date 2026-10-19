/**
 * Said with text selected, an instruction rewrites the selection.
 *
 * The owner selected a paragraph, said "make it bullet points", and got
 * "Make it bullet points." pasted over it: the selection never reached the
 * server, so the instruction was written as a dictation. The desktop now
 * sends what was selected with the audio (or with the live path's text), and
 * the answer is the selection rewritten, to paste over it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { speechClip, wav } from "./audio-fixtures.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

const SAID = "um make this bullet points";
const BULLETS = "- Ship on Friday\n- Tell the team";
const seen = vi.hoisted(() => ({ calls: [] as Array<{ system: string; user: string }> }));
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "" }) } };
    chat = {
      completions: {
        create: async (req: { messages: Array<{ content: string }> }) => {
          seen.calls.push({ system: req.messages[0]!.content, user: req.messages.at(-1)!.content });
          return { choices: [{ message: { content: BULLETS } }] };
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));
vi.mock("groq-sdk", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: SAID, segments: [{ text: SAID, no_speech_prob: 0.01, avg_logprob: -0.1 }] }) } };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const { buildApp } = await import("../src/server.js");

const SELECTED = "We ship on Friday and we should tell the team.";
const SPOKEN = /said out loud while the text was selected/;

function form(fields: Record<string, string>): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----tz";
  const parts = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  return {
    payload: Buffer.concat([
      ...parts,
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      wav(speechClip()),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => { seen.calls.length = 0; });

describe("POST /v1/transcribe-clean with a selection", () => {
  it("rewrites the selection to follow what was said, to paste over it", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/transcribe-clean", ...form({ selection: SELECTED, context: "Notes:" }) });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.cleanedText).toBe(BULLETS);
    expect(json.transcript).toBe(SAID);
    expect(json.replacedSelection).toBe(true);
    expect(json.joinWithSpace).toBe(false);
    // One writing call: the edit, with the selection as its text and what
    // was said as its instruction.
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]!.system).toMatch(SPOKEN);
    expect(seen.calls[0]!.user).toContain(`<text>\n${SELECTED}\n</text>`);
    expect(seen.calls[0]!.user).toContain(`<instruction>\n${SAID}\n</instruction>`);
  });

  it("writes a dictation as before when nothing is selected", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/transcribe-clean", ...form({ context: "Notes:" }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().replacedSelection).toBeUndefined();
    expect(seen.calls[0]!.system).not.toMatch(SPOKEN);
  });

  it("treats a selection of only whitespace as no selection", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/transcribe-clean", ...form({ selection: "  \n " }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().replacedSelection).toBeUndefined();
  });

  it("never uses a selection from a private window", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/transcribe-clean", ...form({ selection: SELECTED, privateField: "true" }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().replacedSelection).toBeUndefined();
    expect(seen.calls.map((c) => c.user).join("\n")).not.toContain(SELECTED);
  });

  it("refuses a selection over the text cap", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/transcribe-clean", ...form({ selection: "x".repeat(10_001) }) });
    expect(res.statusCode).toBe(413);
    expect(seen.calls).toHaveLength(0);
  });
});

describe("POST /v1/refine with a selection (the live path)", () => {
  it("rewrites the selection to follow the text it was given", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/refine", payload: { text: SAID, selection: SELECTED, context: "Notes:" } });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.refinedText).toBe(BULLETS);
    expect(json.replacedSelection).toBe(true);
    expect(json.joinWithSpace).toBe(false);
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]!.system).toMatch(SPOKEN);
    expect(seen.calls[0]!.user).toContain(`<text>\n${SELECTED}\n</text>`);
  });

  it("writes the text as before when nothing is selected", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/refine", payload: { text: SAID } });
    expect(res.statusCode).toBe(200);
    expect(res.json().replacedSelection).toBeUndefined();
    expect(seen.calls[0]!.system).not.toMatch(SPOKEN);
  });

  it("never uses a selection from a private window", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/refine", payload: { text: SAID, selection: SELECTED, privateField: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().replacedSelection).toBeUndefined();
  });

  it("refuses a selection over the text cap", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/refine", payload: { text: SAID, selection: "x".repeat(10_001) } });
    expect(res.statusCode).toBe(413);
  });
});
