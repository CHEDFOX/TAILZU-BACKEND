/**
 * Tone "none" is no tone ON TOP of the voice — never no voice, never no
 * refinement.
 *
 * The owner: "the desktop feels like the raw live transcripts are arriving",
 * and expects it to write like the phone, in the voice chosen on the Voices
 * screen. Every built-in voice defaults to tone "none" and the desktop always
 * sends the account's tone, so "none" is what arrives. The Zu wording for
 * "none" ("not a style. Change nothing about how they sound") used to be sent
 * BESIDE the chosen voice's style, and the one that says change nothing won.
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

const seen = vi.hoisted(() => ({ systems: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "" }) } };
    chat = {
      completions: {
        create: async (req: { messages: Array<{ content: string }> }) => {
          seen.systems.push(req.messages[0]!.content);
          return { choices: [{ message: { content: "Hey, how are you?" } }] };
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));
vi.mock("groq-sdk", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "hey how are you", segments: [{ text: "hey how are you", no_speech_prob: 0.01, avg_logprob: -0.1 }] }) } };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const { toneGuidance } = await import("../src/pipeline/assistPrompt.js");
const { buildApp } = await import("../src/server.js");

const WARMTH = "Write with warmth";
const ZU_NONE = /Change nothing about how they sound/;

describe("the voice rides on tone none", () => {
  it("writes in the chosen voice, with no other style on top", () => {
    for (const tone of ["none", undefined]) {
      const g = toneGuidance(tone, { activePresetId: "friendly", activeTone: "none" } as never);
      expect(g, String(tone)).toContain(WARMTH);
      expect(g, String(tone)).toMatch(/in the voice they chose/);
      expect(g, String(tone)).not.toMatch(ZU_NONE);
    }
  });

  it("does the same for a voice the user made themselves", () => {
    const g = toneGuidance("none", {
      activePresetId: "my-voice",
      presetOverrides: { "my-voice": { name: "Mine", promptStyle: "Short, dry, no greetings." } },
    } as never);
    expect(g).toContain("Short, dry, no greetings.");
    expect(g).not.toMatch(ZU_NONE);
  });

  it("keeps Zu as Zu: their own voice, repaired", () => {
    expect(toneGuidance("none", { activePresetId: "signature" } as never)).toMatch(ZU_NONE);
    expect(toneGuidance("none", undefined)).toMatch(ZU_NONE);
  });

  it("layers a real tone over the voice rather than replacing it", () => {
    const g = toneGuidance("casual", { activePresetId: "friendly" } as never);
    expect(g).toMatch(/The way they would talk to a friend/);
    expect(g).toContain(WARMTH);
  });
});

describe("through the routes the desktop calls", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    // The phone's Voices screen saves the chosen voice on the account.
    const put = await app.inject({ method: "PUT", url: "/v1/personality", payload: { activePresetId: "friendly", activeTone: "none" } });
    expect(put.statusCode).toBe(200);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { seen.systems.length = 0; });

  it("POST /v1/refine/none writes in the account's voice", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/refine/none", payload: { text: "hey how are you", targetApp: "Desktop" } });
    expect(res.statusCode).toBe(200);
    expect(seen.systems[0]).toContain(WARMTH);
    expect(seen.systems[0]).not.toMatch(ZU_NONE);
    expect(res.json().joinWithSpace).toBe(false);   // no context sent
  });

  it("POST /v1/transcribe-clean with tone none writes in the account's voice", async () => {
    const boundary = "----tz";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="tone"\r\n\r\nnone\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="context"\r\n\r\nSo see that and\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      wav(speechClip()),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: "POST", url: "/v1/transcribe-clean", payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(200);
    expect(seen.systems[0]).toContain(WARMTH);
    expect(seen.systems[0]).not.toMatch(ZU_NONE);
    const json = res.json();
    expect(json.cleanedText).toBe("Hey, how are you?");
    expect(json.joinWithSpace).toBe(true);
    expect(json.noSpeech).toBeUndefined();
    expect(json.speech.voicedSeconds).toBeGreaterThan(0.5);
  });
});
